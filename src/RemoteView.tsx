import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { scanOf } from "./scancodes";
import { Badge } from "./Pairing";

/** The remote screen window (label `remote-*`): the other computer's display, and this computer's mouse and
 *  keyboard sent there while the pointer is over it. Wire format: `screen.rs`. */
export function RemoteView() {
  const q = new URLSearchParams(location.search);
  const fingerprint = q.get("remote") ?? "";
  const alias = q.get("alias") ?? "the other computer";
  const canvas = useRef<HTMLCanvasElement>(null);
  const idRef = useRef<number | null>(null);
  const [state, setState] = useState<{ at: "connecting" } | { at: "live"; fps: number; kb: number } | { at: "ended"; why: string }>({ at: "connecting" });
  const [inside, setInside] = useState(false);
  // the drawn image's rectangle inside the canvas, for mapping pointer positions
  const fit = useRef({ x: 0, y: 0, w: 1, h: 1 });
  const size = useRef({ w: 0, h: 0 });

  useEffect(() => {
    document.title = `${alias} — TCuFlow`;
    let id: number | null = null;
    let gone = false;
    let pending = new Uint8Array(0);
    let frames = 0;
    let bytes = 0;
    let drawing = false;
    let latest: Blob | null = null;
    // H.264 through the webview's WebCodecs when it has them (WebKit 16.4+, WebView2); JPEG otherwise
    const canVideo = typeof VideoDecoder !== "undefined";
    let decoder: VideoDecoder | null = null;
    let latestFrame: VideoFrame | null = null;
    let decoderBroken = false;
    const meter = setInterval(() => {
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

    /** Falls back to JPEG for the rest of the session when decoding fails. */
    const videoFailed = (e: unknown) => {
      if (decoderBroken) return;
      decoderBroken = true;
      console.warn("remote screen: video decode failed, back to JPEG", e);
      try {
        decoder?.close();
      } catch {}
      decoder = null;
      sendCodec(false);
    };

    const ensureDecoder = () => {
      if (decoder && decoder.state === "configured") return decoder;
      decoder = new VideoDecoder({
        output: (f) => {
          latestFrame?.close();
          latestFrame = f;
          drawFrame();
        },
        error: videoFailed,
      });
      // Annex B stream (no description): SPS/PPS come with every key frame; constrained baseline, level 4
      decoder.configure({ codec: "avc1.42E028", optimizeForLatency: true });
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
          const d = ensureDecoder();
          // a decoder can only start on a key frame; the server sends one first, and after every size change
          if (d.decodeQueueSize > 4 && !key) return; // behind: let it catch up on the next key frame
          d.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: Math.round(performance.now() * 1000), data: body.slice(5) }));
        } catch (e) {
          videoFailed(e);
        }
      } else if (tag === 2 && body.length >= 8) {
        const v = new DataView(body.buffer, body.byteOffset);
        size.current = { w: v.getUint32(0, true), h: v.getUint32(4, true) };
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
        else if (canVideo) sendCodec(true);
      },
      (e) => {
        gone = true;
        setState({ at: "ended", why: String(e) });
      },
    );
    return () => {
      clearInterval(meter);
      latestFrame?.close();
      try {
        decoder?.close();
      } catch {}
      if (id !== null) invoke("remote_close", { id });
    };
  }, [fingerprint, alias]);

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
        <span className="ml-auto">{inside ? "Keyboard goes to " + alias + " · move the pointer off the screen to type here" : "Move the pointer over the screen to control it"}</span>
      </div>
      {state.at === "ended" ? (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div className="max-w-md">
            <p className="text-lg font-semibold">Can't show {alias}'s screen</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{state.why}</p>
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
