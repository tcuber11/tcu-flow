import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { scanOf } from "./scancodes";
import { Badge, quietButton } from "./Pairing";

/** The other computer's display, with input sent there. On a computer (window `remote-*`) its mouse and keyboard
 *  while the pointer is over the picture; on a phone or tablet (`touch`, full screen, `onClose` goes back) a tap
 *  clicks, a long press right-clicks, one finger drags, two scroll, a pinch zooms the picture, and its keyboard
 *  types. Wire format: `screen.rs`. */
export function RemoteView({ fingerprint, alias, touch = false, onClose }: { fingerprint: string; alias: string; touch?: boolean; onClose?: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const idRef = useRef<number | null>(null);
  const [state, setState] = useState<{ at: "connecting" } | { at: "live"; fps: number; kb: number } | { at: "ended"; why: string }>({ at: "connecting" });
  const [inside, setInside] = useState(false);
  // every display the other computer has, and which one is shown (a picker when there is more than one)
  const [displays, setDisplays] = useState<{ list: { w: number; h: number; primary: boolean }[]; shown: number }>({ list: [], shown: 0 });
  // the drawn image's rectangle inside the canvas, for mapping pointer positions
  const fit = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const size = useRef({ w: 0, h: 0 });

  useEffect(() => {
    if (!touch) document.title = `${alias} — TCuFlow`;
    let id: number | null = null;
    let gone = false;
    let pending = new Uint8Array(0);
    let frames = 0;
    let bytes = 0;
    let drawing = false;
    let latest: Blob | null = null;
    // H.264 through the webview's WebCodecs when it has them (WebKit 16.4+, WebView2); JPEG otherwise
    // Annex B, constrained baseline, level 4: what both of the other side's encoders produce
    const AVC = { codec: "avc1.42E028", optimizeForLatency: true };
    const canVideo: Promise<boolean> =
      typeof VideoDecoder === "undefined" ? Promise.resolve(false) : VideoDecoder.isConfigSupported(AVC).then((r) => r.supported === true, () => false);
    // a sharer on 0.9.10 or later (its INFO lists the displays) understands frames 7–9; an older one ends the
    // session on any of them
    let modern = false;
    // a decoder that lost its place (fell behind, or failed once) skips deltas until the key frame it asked for,
    // asking again each second
    let waitingKey = false;
    let asks = 0;
    let askedAt = 0;
    let decodeErrors = 0;
    let decoder: VideoDecoder | null = null;
    let latestFrame: VideoFrame | null = null;
    let decoderBroken = false;
    // clipboard both ways: what this computer copies goes over while the window is open, and back. `null` until
    // the session opens, with what is on this clipboard then, which stays here. A phone doesn't poll: iOS asks the
    // user each time an app reads the clipboard, so there it goes over only from its button (sendClipboard).
    let lastClip: string | null = null;
    const clipPoll = setInterval(async () => {
      if (touch || gone || idRef.current === null || document.hidden || !modern || lastClip === null) return;
      const text = await invoke<string | null>("remote_clipboard_get").catch(() => null);
      if (!text || text === lastClip) return;
      lastClip = text;
      const bytes = new TextEncoder().encode(text);
      if (bytes.length > 1 << 20) return;
      const head = new Uint8Array(9);
      head[0] = 8;
      new DataView(head.buffer).setUint32(1, bytes.length, true);
      invoke("remote_input", { id: idRef.current, data: [...head, ...bytes] });
    }, 1000);
    const meter = setInterval(() => {
      if (waitingKey && !decoderBroken && performance.now() - askedAt > 1000) askKey();
      if (!gone) setState((s) => (s.at === "live" || s.at === "connecting" ? { at: "live", fps: frames, kb: Math.round(bytes / 1024) } : s));
      frames = 0;
      bytes = 0;
    }, 1000);

    /** Fits `img` (a decoded JPEG or a video frame) into the canvas, remembering where it sits for input. */
    const paint = (img: ImageBitmap | VideoFrame, iw: number, ih: number) => {
      const c = canvas.current;
      if (!c) return;
      const dpr = devicePixelRatio || 1;
      const cw = Math.round(c.clientWidth * dpr);
      const ch = Math.round(c.clientHeight * dpr);
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
      }
      const scale = Math.min(cw / iw, ch / ih);
      const w = Math.round(iw * scale);
      const h = Math.round(ih * scale);
      const x = Math.round((cw - w) / 2);
      const y = Math.round((ch - h) / 2);
      fit.current = { x: x / dpr, y: y / dpr, w: w / dpr, h: h / dpr };
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, x, y, w, h);
      frames++;
    };

    const draw = async () => {
      if (drawing || !latest) return;
      drawing = true;
      const blob = latest;
      latest = null;
      try {
        const bmp = await createImageBitmap(blob);
        paint(bmp, bmp.width, bmp.height);
        bmp.close();
      } finally {
        drawing = false;
        if (latest) void draw();
      }
    };

    // the newest decoded frame wins; older ones that were still queued are dropped unseen
    const drawFrame = () => {
      const f = latestFrame;
      if (!f) return;
      latestFrame = null;
      paint(f, f.displayWidth, f.displayHeight);
      f.close();
    };

    const sendCodec = (video: boolean) => {
      if (idRef.current === null) return;
      const b = new Uint8Array(9);
      b[0] = 6;
      b[1] = video ? 1 : 0;
      invoke("remote_input", { id: idRef.current, data: Array.from(b) });
    };

    const askKey = () => {
      if (idRef.current === null) return;
      if (!modern || ++asks > 5) {
        // an older sharer can't send a key frame on request, and one that never comes won't either: plain JPEG
        decoderBroken = true;
        waitingKey = false;
        sendCodec(false);
        return;
      }
      askedAt = performance.now();
      const b = new Uint8Array(9);
      b[0] = 9;
      invoke("remote_input", { id: idRef.current, data: Array.from(b) });
    };

    /** A failed decode starts over from a fresh key frame once; failing again, the session goes back to JPEG. */
    const videoFailed = (e: unknown) => {
      try {
        decoder?.close();
      } catch {}
      decoder = null;
      if (decoderBroken) return;
      if (++decodeErrors === 1) {
        console.warn("remote screen: video decode failed, starting over from a key frame", e);
        waitingKey = true;
        askKey();
        return;
      }
      decoderBroken = true;
      console.warn("remote screen: video decode failed again, back to JPEG", e);
      sendCodec(false);
    };

    const ensureDecoder = () => {
      if (decoder && decoder.state === "configured") return decoder;
      decoder = new VideoDecoder({
        output: (f) => {
          decodeErrors = 0; // decoding again: a later failure gets its own fresh start
          latestFrame?.close();
          latestFrame = f;
          drawFrame();
        },
        error: videoFailed,
      });
      // Annex B stream (no description): SPS/PPS come with every key frame
      decoder.configure(AVC);
      return decoder;
    };

    const handle = (tag: number, body: Uint8Array) => {
      if (tag === 1) {
        bytes += body.length;
        latest = new Blob([body.slice()], { type: "image/jpeg" });
        void draw();
      } else if (tag === 4 && body.length > 5) {
        bytes += body.length;
        if (decoderBroken) return;
        const key = body[0] === 1;
        try {
          // a delta frame only makes sense on top of every frame before it: none are skipped, except
          // while waiting for a key frame, which starts the picture over
          if (waitingKey && !key) return;
          const d = ensureDecoder();
          if (!key && d.decodeQueueSize > 8) {
            waitingKey = true; // fell behind: catch up from a fresh key frame instead of queueing more
            askKey();
            return;
          }
          waitingKey = false;
          if (key) asks = 0;
          d.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: Math.round(performance.now() * 1000), data: body.slice(5) }));
        } catch (e) {
          videoFailed(e);
        }
      } else if (tag === 5) {
        // copied over there: onto this clipboard, remembered so the poll below doesn't send it back
        const text = new TextDecoder().decode(body);
        lastClip = text;
        invoke("remote_clipboard_set", { text });
      } else if (tag === 2 && body.length >= 8) {
        const v = new DataView(body.buffer, body.byteOffset);
        size.current = { w: v.getUint32(0, true), h: v.getUint32(4, true) };
        if (body.length >= 10) {
          modern = true;
          const n = Math.min(body[9], Math.floor((body.length - 10) / 9));
          const list = [];
          for (let i = 0; i < n; i++) {
            const at = 10 + i * 9;
            list.push({ w: v.getUint32(at, true), h: v.getUint32(at + 4, true), primary: body[at + 8] === 1 });
          }
          setDisplays({ list, shown: body[8] });
        }
      } else if (tag === 3) {
        gone = true;
        setState({ at: "ended", why: new TextDecoder().decode(body) });
      }
    };

    const onData = new Channel<ArrayBuffer>();
    onData.onmessage = (buf) => {
      if (!buf.byteLength) {
        if (!gone) setState({ at: "ended", why: `${alias} stopped sharing its screen, or the link dropped.` });
        gone = true;
        return;
      }
      // reassemble `tag | u32 len | body` across chunks
      const joined = new Uint8Array(pending.length + buf.byteLength);
      joined.set(pending);
      joined.set(new Uint8Array(buf), pending.length);
      let at = 0;
      while (joined.length - at >= 5) {
        const tag = joined[at];
        const len = new DataView(joined.buffer, joined.byteOffset + at + 1, 4).getUint32(0, true);
        if (len > 8 << 20) {
          gone = true;
          setState({ at: "ended", why: "bad frame from the other computer" });
          return;
        }
        if (joined.length - at - 5 < len) break;
        handle(tag, joined.subarray(at + 5, at + 5 + len));
        at += 5 + len;
      }
      pending = joined.slice(at);
    };
    invoke<number>("remote_open", { fingerprint, onData }).then(
      (i) => {
        id = i;
        idRef.current = i;
        if (gone) invoke("remote_close", { id: i });
        else void canVideo.then((ok) => ok && !gone && sendCodec(true));
        if (touch) return;
        invoke<string | null>("remote_clipboard_get").then(
          (t) => {
            if (lastClip === null) lastClip = t ?? "";
          },
          () => {
            if (lastClip === null) lastClip = "";
          },
        );
      },
      (e) => {
        gone = true;
        setState({ at: "ended", why: String(e) });
      },
    );
    return () => {
      clearInterval(meter);
      clearInterval(clipPoll);
      latestFrame?.close();
      try {
        decoder?.close();
      } catch {}
      if (id !== null) invoke("remote_close", { id });
    };
  }, [fingerprint, alias, touch]);

  // ---- input → the other computer
  const send = (bytes: number[]) => idRef.current !== null && invoke("remote_input", { id: idRef.current, data: bytes });
  const frame = (tag: number, fill: (v: DataView) => void) => {
    const b = new ArrayBuffer(9);
    const v = new DataView(b);
    v.setUint8(0, tag);
    fill(v);
    return Array.from(new Uint8Array(b));
  };
  const moveAt = useRef(0);
  const onMove = (e: React.PointerEvent) => {
    const f = fit.current;
    const r = canvas.current!.getBoundingClientRect();
    const nx = (e.clientX - r.left - f.x) / f.w;
    const ny = (e.clientY - r.top - f.y) / f.h;
    const over = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
    setInside(over);
    if (!over) return;
    const now = performance.now();
    if (now - moveAt.current < 16) return; // ~60 Hz is plenty over the link
    moveAt.current = now;
    send(frame(1, (v) => (v.setFloat32(1, nx, true), v.setFloat32(5, ny, true))));
  };
  const button = (e: React.PointerEvent, down: boolean) => {
    if (!inside) return;
    e.preventDefault();
    const b = e.button === 0 ? 1 : e.button === 2 ? 2 : e.button === 1 ? 3 : 0;
    if (!b) return;
    if (down) canvas.current!.focus();
    onMove(e);
    send(frame(2, (v) => (v.setUint8(1, b), v.setUint8(2, down ? 1 : 0))));
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!inside) return;
    const unit = e.deltaMode === 1 ? 120 : e.deltaMode === 2 ? 120 * 10 : 1.2; // lines, pages, pixels (~100 px per notch)
    const dx = Math.round(-e.deltaX * unit);
    const dy = Math.round(-e.deltaY * unit);
    if (dx || dy) send(frame(3, (v) => (v.setInt32(1, dx, true), v.setInt32(5, dy, true))));
  };
  const key = (e: React.KeyboardEvent, down: boolean) => {
    if (!inside) return;
    e.preventDefault();
    const scan = scanOf(e.code);
    if (scan !== undefined) return send(frame(4, (v) => (v.setUint16(1, scan, true), v.setUint8(3, down ? 1 : 0))));
    // a key this table doesn't know (a dead key's result, an IME): type its text instead
    if (down && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const text = new TextEncoder().encode(e.key);
      send([5, ...Array.from(new Uint8Array(new Uint32Array([text.length]).buffer)), 0, 0, 0, 0, ...Array.from(text)]);
    }
  };

  // ---- touch (phone, tablet): gestures on the picture, a keyboard, the clipboard on request
  // the picture's zoom and offset inside its box; a pinch changes them, two fingers pan while zoomed in
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const box = useRef<HTMLDivElement>(null);
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  type Gesture =
    | { kind: "none" | "done" }
    | { kind: "one" | "drag"; x0: number; y0: number; timer: number }
    | { kind: "two" | "zoom"; mid: { x: number; y: number }; last: { x: number; y: number }; dist: number; z0: number; v0: { x: number; y: number } };
  const gesture = useRef<Gesture>({ kind: "none" });
  const scrollRest = useRef(0);
  /** A screen point → where on the other computer's display, or null off the picture. */
  const spot = (clientX: number, clientY: number) => {
    const f = fit.current;
    const r = canvas.current!.getBoundingClientRect();
    const z = viewRef.current.z;
    const nx = ((clientX - r.left) / z - f.x) / f.w;
    const ny = ((clientY - r.top) / z - f.y) / f.h;
    return nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 ? { nx, ny } : null;
  };
  const moveTo = (clientX: number, clientY: number) => {
    const p = spot(clientX, clientY);
    if (p) send(frame(1, (v) => (v.setFloat32(1, p.nx, true), v.setFloat32(5, p.ny, true))));
    return !!p;
  };
  const press = (b: number, down: boolean) => send(frame(2, (v) => (v.setUint8(1, b), v.setUint8(2, down ? 1 : 0))));
  const clickAt = (clientX: number, clientY: number, b: number) => {
    if (!moveTo(clientX, clientY)) return;
    press(b, true);
    press(b, false);
  };
  /** Keeps the zoomed picture covering its box. */
  const clampView = (z: number, x: number, y: number) => {
    const r = box.current!.getBoundingClientRect();
    return { z, x: Math.min(0, Math.max(r.width - r.width * z, x)), y: Math.min(0, Math.max(r.height - r.height * z, y)) };
  };

  const tDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const all = [...fingers.current.values()];
    const g = gesture.current;
    if ("timer" in g) clearTimeout(g.timer);
    if (all.length === 1) {
      // held still: a right click where the finger rests
      const timer = window.setTimeout(() => {
        const now = gesture.current;
        if (now.kind !== "one") return;
        clickAt(now.x0, now.y0, 2);
        gesture.current = { kind: "done" };
      }, 550);
      gesture.current = { kind: "one", x0: e.clientX, y0: e.clientY, timer };
    } else if (all.length === 2) {
      if (g.kind === "drag") press(1, false);
      const [a, b] = all;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const v = viewRef.current;
      gesture.current = { kind: "two", mid, last: mid, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: v.z, v0: { x: v.x, y: v.y } };
    }
  };

  const tMove = (e: React.PointerEvent) => {
    if (!fingers.current.has(e.pointerId)) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const all = [...fingers.current.values()];
    const g = gesture.current;
    if ((g.kind === "one" || g.kind === "drag") && all.length === 1) {
      if (g.kind === "one") {
        if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 8) return;
        clearTimeout(g.timer);
        if (!moveTo(g.x0, g.y0)) return void (gesture.current = { kind: "done" });
        press(1, true); // a drag: held from where the finger started
        gesture.current = { ...g, kind: "drag" };
      }
      const now = performance.now();
      if (now - moveAt.current < 16) return;
      moveAt.current = now;
      moveTo(e.clientX, e.clientY);
    } else if ((g.kind === "two" || g.kind === "zoom") && all.length === 2) {
      const [a, b] = all;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = Math.hypot(a.x - b.x, a.y - b.y) / g.dist;
      if (g.kind === "two" && Math.abs(scale - 1) > 0.08) g.kind = "zoom";
      const r = box.current!.getBoundingClientRect();
      if (g.kind === "zoom") {
        // the point under the fingers' first midpoint stays under their midpoint now
        const z = Math.min(5, Math.max(1, g.z0 * scale));
        const px = (g.mid.x - r.left - g.v0.x) / g.z0;
        const py = (g.mid.y - r.top - g.v0.y) / g.z0;
        setView(clampView(z, mid.x - r.left - px * z, mid.y - r.top - py * z));
      } else if (viewRef.current.z > 1) {
        const v = viewRef.current;
        setView(clampView(v.z, v.x + mid.x - g.last.x, v.y + mid.y - g.last.y));
      } else {
        // fingers up move the page down, as on the phone itself
        scrollRest.current += (mid.y - g.last.y) * 3;
        const dy = Math.trunc(scrollRest.current);
        scrollRest.current -= dy;
        if (dy) send(frame(3, (v) => (v.setInt32(1, 0, true), v.setInt32(5, dy, true))));
      }
      g.last = mid;
    }
  };

  const tUp = (e: React.PointerEvent) => {
    fingers.current.delete(e.pointerId);
    const g = gesture.current;
    if (fingers.current.size > 0) {
      if (g.kind === "two" || g.kind === "zoom") gesture.current = { kind: "done" }; // the rest of a two-finger gesture
      return;
    }
    if (g.kind === "one") {
      clearTimeout(g.timer);
      clickAt(g.x0, g.y0, 1);
    } else if (g.kind === "drag") press(1, false);
    gesture.current = { kind: "none" };
  };

  // the phone's keyboard types into an off-screen box; what lands there goes over as text, Return and
  // Backspace as keys. The box keeps one space so a Backspace on an empty line still registers.
  const keys = useRef<HTMLTextAreaElement>(null);
  const [typing, setTyping] = useState(false);
  const tap = (code: string) => {
    const scan = scanOf(code);
    if (scan === undefined) return;
    send(frame(4, (v) => (v.setUint16(1, scan, true), v.setUint8(3, 1))));
    send(frame(4, (v) => (v.setUint16(1, scan, true), v.setUint8(3, 0))));
  };
  const sendText = (t: string) => {
    if (!t) return;
    const text = new TextEncoder().encode(t);
    send([5, ...Array.from(new Uint8Array(new Uint32Array([text.length]).buffer)), 0, 0, 0, 0, ...Array.from(text)]);
  };
  const typed = () => {
    const el = keys.current!;
    const now = el.value;
    if (now.length === 0) tap("Backspace");
    else
      for (const part of now.slice(1).split(/(\n)/))
        if (part === "\n") tap("Enter");
        else sendText(part);
    el.value = " ";
  };
  const toggleKeys = () => {
    const el = keys.current!;
    if (typing) return el.blur();
    el.value = " ";
    el.focus();
    setTyping(true);
  };
  const [clipNote, setClipNote] = useState("");
  /** This device's clipboard text, once, to the other computer's clipboard (iOS asks the user first). */
  const sendClipboard = async () => {
    const text = await invoke<string | null>("remote_clipboard_get").catch(() => null);
    if (!text) return setClipNote("Nothing to send");
    const bytes = new TextEncoder().encode(text);
    const head = new Uint8Array(9);
    head[0] = 8;
    new DataView(head.buffer).setUint32(1, bytes.length, true);
    send([...head, ...bytes]);
    setClipNote(`Copied to ${alias}`);
    setTimeout(() => setClipNote(""), 2000);
  };

  if (touch)
    return (
      <div className="flex h-full flex-col bg-black text-fg">
        <div className="flex shrink-0 items-center gap-2 bg-raised px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)] text-xs text-muted">
          <button onClick={onClose} aria-label="Back" className={quietButton + " grid h-10 w-10 place-items-center p-0 text-lg"}>
            ‹
          </button>
          <span className="min-w-0 truncate font-semibold text-fg">{alias}</span>
          {state.at === "live" ? <Badge tone="success">Live</Badge> : state.at === "connecting" ? <Badge tone="accent">Connecting…</Badge> : <Badge tone="danger">Ended</Badge>}
          {displays.list.length > 1 && (
            <span className="flex items-center gap-1" role="group" aria-label="Which display to show">
              {displays.list.map((d, i) => (
                <button
                  key={i}
                  onClick={() => send(frame(7, (v) => v.setUint8(1, i)))}
                  aria-pressed={i === displays.shown}
                  aria-label={`Display ${i + 1}${d.primary ? ", main" : ""}`}
                  className={`h-8 min-w-8 rounded-md px-2 ${i === displays.shown ? "bg-accent text-white" : "bg-tint/10 text-muted"}`}
                >
                  {i + 1}
                </button>
              ))}
            </span>
          )}
          <span className="ml-auto flex gap-1">
            {view.z > 1 && (
              <button onClick={() => setView({ z: 1, x: 0, y: 0 })} className={quietButton + " min-h-10 px-3"}>
                Fit
              </button>
            )}
            <button onClick={sendClipboard} className={quietButton + " min-h-10 px-3"}>
              {clipNote || "Paste there"}
            </button>
            <button onClick={toggleKeys} aria-pressed={typing} className={quietButton + " min-h-10 px-3 aria-pressed:text-fg"}>
              Keyboard
            </button>
          </span>
        </div>
        {state.at === "ended" ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div className="max-w-md">
              <p className="text-lg font-semibold">Can't show {alias}'s screen</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{state.why}</p>
              {onClose && (
                <button onClick={onClose} className={quietButton + " mt-5 min-h-11"}>
                  Back
                </button>
              )}
            </div>
          </div>
        ) : (
          <div ref={box} className="relative min-h-0 flex-1 touch-none overflow-hidden select-none">
            <canvas
              ref={canvas}
              aria-label={`${alias}'s screen`}
              className="absolute inset-0 h-full w-full origin-top-left"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
              onPointerDown={tDown}
              onPointerMove={tMove}
              onPointerUp={tUp}
              onPointerCancel={tUp}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
        )}
        <p className="shrink-0 bg-raised px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 text-center text-xs text-faint">
          Tap to click · hold to right-click · drag · two fingers scroll · pinch to zoom
        </p>
        <textarea
          ref={keys}
          onInput={typed}
          onBlur={() => setTyping(false)}
          aria-label={`Type on ${alias}`}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="fixed -left-[200vw] top-1/2 h-10 w-40 opacity-0"
        />
      </div>
    );

  return (
    <div className="flex h-full flex-col bg-black text-fg">
      <div className="flex h-9 shrink-0 items-center gap-3 bg-raised px-3 text-xs text-muted">
        <span className="font-semibold text-fg">{alias}</span>
        {state.at === "live" ? (
          <>
            <Badge tone="success">Live</Badge>
            <span className="tabular-nums">
              {state.fps} fps · {state.kb} KB/s
            </span>
          </>
        ) : state.at === "connecting" ? (
          <Badge tone="accent">Connecting…</Badge>
        ) : (
          <Badge tone="danger">Ended</Badge>
        )}
        {displays.list.length > 1 && (
          <span className="flex items-center gap-1" role="group" aria-label="Which display to show">
            {displays.list.map((d, i) => (
              <button
                key={i}
                onClick={() => send(frame(7, (v) => v.setUint8(1, i)))}
                aria-pressed={i === displays.shown}
                title={`${d.w}×${d.h}${d.primary ? " · main" : ""}`}
                className={`rounded-md px-2 py-0.5 ${i === displays.shown ? "bg-accent text-white" : "bg-tint/10 text-muted hover:text-fg"}`}
              >
                {i + 1}
              </button>
            ))}
          </span>
        )}
        <span className="ml-auto">{inside ? "Keyboard goes to " + alias + " · move the pointer off the screen to type here" : "Move the pointer over the screen to control it"}</span>
      </div>
      {state.at === "ended" ? (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div className="max-w-md">
            <p className="text-lg font-semibold">Can't show {alias}'s screen</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{state.why}</p>
            <button onClick={() => void getCurrentWindow().close()} className={quietButton + " mt-5"}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <canvas
          ref={canvas}
          tabIndex={0}
          aria-label={`${alias}'s screen`}
          className="min-h-0 flex-1 cursor-default outline-none"
          onPointerMove={onMove}
          onPointerDown={(e) => button(e, true)}
          onPointerUp={(e) => button(e, false)}
          onPointerLeave={() => setInside(false)}
          onWheel={onWheel}
          onKeyDown={(e) => key(e, true)}
          onKeyUp={(e) => key(e, false)}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}
    </div>
  );
}
