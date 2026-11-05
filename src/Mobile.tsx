// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RemoteView } from "./RemoteView";
import { DeskScene } from "./Illustration";
import { Wizard, useControl, type Control } from "./Control";
import { Face, clayOf, type Mood } from "./Face";
import { ChevronLeftIcon, DisplayIcon, KeyboardIcon, LaptopIcon, PhoneIcon, SendIcon, TouchpadIcon } from "./icons";
import { AddHost } from "./Home";
import { ConnectionCheck, PairPrompt, StateBadge, deviceState, osLabel, primaryButton, quietButton, stateReason, type Device, type PairedDevice, type Peer } from "./Pairing";
import { REACH, opposite, type Edge, type Portal } from "./calibration";
import { About, useUpdate, type Update } from "./About";
import { UpdatePrompt } from "./UpdatePrompt";

type PairAnswer = "accepted" | "declined" | "noAnswer" | "unknown";
type Pairing = { state: "waiting"; code?: string } | { state: "failed"; note: string };
const FAILED: Record<Exclude<PairAnswer, "accepted">, string> = { declined: "Declined", noAnswer: "No answer", unknown: "It can't see this phone" };

/** The phone app: computers nearby, pairing, and the touchpad that drives a paired one. */
export function Mobile() {
  const [device, setDevice] = useState<Device | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [pairing, setPairing] = useState<Record<string, Pairing>>({});
  const [driving, setDriving] = useState<Peer | null>(null);
  // the computer whose screen is shown full screen here
  const [viewing, setViewing] = useState<Peer | null>(null);
  const [screen, setScreen] = useState<"home" | "wizard" | "settings">("home");
  const [about, setAbout] = useState(false);
  // a computer was just paired: point at the setup that lets it move in
  const [fresh, setFresh] = useState(false);
  const pairedCount = useRef(-1);
  const [note, setNote] = useState("");
  const control = useControl();
  // once per launch, as on computers; phones can't update in place, so Download fetches the APK
  // (an iPhone gets the release page: iOS installs only through TestFlight or the App Store)
  const [prompt, setPrompt] = useState(true);
  const update = useUpdate();
  const apk = update.available && device?.info.os !== "ios" ? `https://github.com/tcuber11/tcu-flow/releases/download/${update.available.tag}/TCuFlow_${update.available.tag.slice(1)}_android.apk` : undefined;
  const files = useRef<HTMLInputElement>(null);
  const sendTo = useRef("");
  const refreshDevice = () =>
    invoke<Device>("get_device").then((d) => {
      if (pairedCount.current >= 0 && d.paired.length > pairedCount.current) setFresh(true);
      pairedCount.current = d.paired.length;
      setDevice(d);
    });

  useEffect(() => {
    const refreshPeers = () => invoke<Peer[]>("peers").then(setPeers);
    refreshDevice();
    const unPeer = listen("peer", refreshPeers);
    unPeer.then(refreshPeers);
    const unPaired = listen("paired", refreshDevice);
    const unDevice = listen("device", refreshDevice);
    const unCode = listen<{ fingerprint: string; code: string }>("pair-code", ({ payload: { fingerprint: f, code } }) =>
      setPairing((s) => (s[f]?.state === "waiting" ? { ...s, [f]: { state: "waiting", code } } : s)),
    );
    const prune = setInterval(refreshPeers, 5000); // devices that went quiet drop off
    return () => {
      for (const un of [unPeer, unPaired, unDevice, unCode]) un.then((f) => f());
      clearInterval(prune);
    };
  }, []);

  if (!device) return null;
  if (driving) return <Touchpad peer={driving} onClose={() => setDriving(null)} />;
  if (viewing) return <RemoteView fingerprint={viewing.info.fingerprint} alias={viewing.info.alias} touch onClose={() => setViewing(null)} />;
  const first = device.paired[0]?.alias ?? "your computer";
  if (screen === "wizard")
    return (
      <Wizard
        computer={first}
        onClose={() => {
          setScreen("home");
          control.refresh();
        }}
      />
    );
  if (screen === "settings")
    return (
      <>
        <Settings device={device} control={control} update={update} onSetup={() => setScreen("wizard")} onAbout={() => setAbout(true)} onClose={() => setScreen("home")} onChange={refreshDevice} />
        {about && (
          <About
            update={update}
            seed={device.info.fingerprint}
            os={device.info.os}
            downloadUrl={apk}
            extra={`Phone control: ${control.status ? JSON.stringify(control.status) : "unavailable"}`}
            onClose={() => setAbout(false)}
            onUpdate={() => setAbout(false)}
          />
        )}
      </>
    );
  const controlCard = device.paired.length > 0 && (
    <ControlCard
      device={device}
      computer={device.paired[0]}
      control={control}
      fresh={fresh}
      onSetup={() => {
        setFresh(false);
        setScreen("wizard");
      }}
      onChange={refreshDevice}
    />
  );
  const running = !!control.status?.running;

  /** Files picked with Android's picker go one by one; the web view gets their bytes, not paths. */
  const send = async (list: FileList | null) => {
    const fingerprint = sendTo.current;
    for (const f of Array.from(list ?? [])) {
      setNote(`Sending ${f.name}…`);
      try {
        // data URL → its base64 part (FileReader encodes natively, unlike a JS loop)
        // the project's TS lib predates Promise.withResolvers
        const data = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
          r.onerror = () => reject(r.error);
          r.readAsDataURL(f);
        });
        await invoke("send_upload", { fingerprint, name: f.name, data });
        setNote(`Sent ${f.name}`);
      } catch (e) {
        setNote(`Couldn't send ${f.name}: ${e}`);
      }
    }
  };

  const isPaired = (f: string) => device.paired.some((p) => p.fingerprint === f);
  const outdated = (p: Peer) => deviceState(p, false, device.info) === "update";
  const nearby = peers.filter((p) => !isPaired(p.info.fingerprint));

  const pair = async (p: Peer) => {
    const f = p.info.fingerprint;
    setPairing((s) => ({ ...s, [f]: { state: "waiting" } }));
    try {
      const answer = await invoke<PairAnswer>("pair", { fingerprint: f });
      setPairing(({ [f]: _, ...rest }) => (answer === "accepted" ? rest : { ...rest, [f]: { state: "failed", note: FAILED[answer] } }));
    } catch (e) {
      setPairing((s) => ({ ...s, [f]: { state: "failed", note: String(e) } }));
    }
  };

  const online = device.paired.filter((d) => peers.some((p) => p.info.fingerprint === d.fingerprint)).length;
  return (
    <main className="mx-auto min-h-full w-full max-w-xl pb-12">
      {/* iOS-style bar: this device's name, sticky and translucent over the list */}
      <header className="sticky top-0 z-10 flex items-center gap-2.5 bg-ink/80 px-5 pb-2 pt-[max(env(safe-area-inset-top),1rem)] backdrop-blur-xl">
        <Face seed={device.info.fingerprint} size={32} kind="phone" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[15px] font-semibold">{device.info.alias}</p>
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
            Visible on this Wi-Fi
          </p>
        </div>
        <button onClick={() => setScreen("settings")} aria-label="Settings" className="clay grid h-10 w-10 place-items-center rounded-full bg-raised text-fg active:scale-95">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </header>

      <div className="px-5">
        <h1 className="rounded-type mt-2 text-[36px] font-bold leading-tight tracking-[-0.02em]">Computers</h1>
        {device.paired.length > 0 && (
          <p className="mt-0.5 text-[15px] text-muted">{online === 0 ? "None of them is on this Wi-Fi right now" : online === 1 && device.paired.length === 1 ? "Ready when you are" : `${online} of ${device.paired.length} on this Wi-Fi`}</p>
        )}

        {!running && controlCard}

        {device.paired.length === 0 && nearby.length === 0 && (
          <div className="mt-14 flex flex-col items-center text-center">
            <DeskScene className="w-72 max-w-full" />
            <p className="rounded-type mt-4 text-[22px] font-semibold">Looking for computers</p>
            <p className="mt-1.5 max-w-[30ch] text-[15px] leading-relaxed text-muted">Open TCuFlow on your Mac or PC, on the same Wi-Fi as this {device.info.os === "ios" ? "device" : "phone"}.</p>
          </div>
        )}

        <ul className="mt-5 space-y-4">
          {device.paired.map((d, i) => {
            const peer = peers.find((p) => p.info.fingerprint === d.fingerprint);
            const state = deviceState(peer, true, device.info);
            const usable = !!peer && state !== "update";
            const reason = state === "offline" ? null : stateReason(state, d.alias, peer?.info.os);
            const { light, deep } = clayOf(d.fingerprint);
            return (
              <li key={d.fingerprint} className="rise clay overflow-hidden rounded-[28px] bg-raised" style={{ "--i": i } as React.CSSProperties}>
                {/* the computer's own clay colour */}
                <div className="flex items-center gap-3.5 px-4 pb-2 pt-4" style={{ background: `linear-gradient(165deg, ${light}66, transparent 75%)` }}>
                  <span
                    aria-hidden
                    className="clay-key grid h-14 w-14 shrink-0 place-items-center rounded-[20px] text-white"
                    style={{ background: `radial-gradient(120% 90% at 30% 15%, ${light}, ${deep})`, filter: peer ? undefined : "saturate(0.15)" }}
                  >
                    {d.mobile ? <PhoneIcon size={28} /> : <LaptopIcon size={30} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="rounded-type truncate text-[20px] font-semibold">{d.alias}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-muted">
                      <span aria-hidden className={`h-2 w-2 rounded-full ${!peer ? "bg-faint/60" : state === "update" ? "bg-warning" : "bg-success"}`} />
                      {!peer ? "Not on this Wi-Fi" : state === "update" ? "Needs a TCuFlow update" : `Online · ${osLabel(peer.info.os)}`}
                    </p>
                  </div>
                  {state === "update" && <StateBadge state={state} />}
                </div>
                {reason && <p className="px-4 pt-1 text-[14px] leading-relaxed text-muted">{reason}.</p>}
                <div className="grid grid-cols-3 gap-2.5 p-3.5">
                  <Tile tone="accent" icon={<TouchpadIcon size={24} />} label="Touchpad" disabled={state !== "ready"} onClick={() => peer && setDriving(peer)} />
                  <Tile icon={<DisplayIcon size={24} />} label="Screen" disabled={!usable} onClick={() => peer && setViewing(peer)} />
                  <Tile
                    tone="warm"
                    icon={<SendIcon size={22} />}
                    label="Send files"
                    disabled={!usable}
                    onClick={() => {
                      sendTo.current = d.fingerprint;
                      files.current?.click();
                    }}
                  />
                </div>
                <div className="border-t border-line px-4 py-1 text-[15px]">
                  <ConnectionCheck fingerprint={d.fingerprint} link />
                </div>
              </li>
            );
          })}
        </ul>
        <input ref={files} type="file" multiple hidden onChange={(e) => send(e.currentTarget.files).finally(() => (e.target.value = ""))} />
        {note && (
          <p role="status" className="mt-3 px-1 text-[14px] text-muted">
            {note}
          </p>
        )}

        {running && controlCard}

        {nearby.length > 0 && (
          <section aria-labelledby="nearby-title" className="mt-9">
            <h2 id="nearby-title" className="px-4 text-[13px] font-normal uppercase tracking-wide text-muted">
              Nearby
            </h2>
            <ul className="clay mt-2 divide-y divide-line overflow-hidden rounded-[24px] bg-raised">
              {nearby.map((p) => {
                const s = pairing[p.info.fingerprint];
                const mood: Mood = s?.state === "waiting" ? "waiting" : s ? "sad" : "idle";
                const note = outdated(p) ? "Needs TCuFlow update" : s?.state === "waiting" ? (s.code ? `Code ${s.code}: check it matches` : "Asking…") : s ? s.note : osLabel(p.info.os);
                return (
                  <li key={p.info.fingerprint} className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
                    <Face seed={p.info.fingerprint} size={36} mood={mood} kind={p.info.deviceType === "mobile" ? "phone" : "computer"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[17px]">{p.info.alias}</p>
                      <p className={"text-[13px] " + (s?.state === "failed" ? "text-danger" : "text-muted")}>{note}</p>
                    </div>
                    <button
                      disabled={outdated(p) || s?.state === "waiting"}
                      onClick={() => pair(p)}
                      className="clay-key min-h-9 rounded-full bg-accent px-4 text-[15px] font-semibold text-on-accent transition-transform active:scale-95 disabled:opacity-40"
                    >
                      Pair
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 px-4 text-[13px] leading-snug text-muted">Computers running TCuFlow on this Wi-Fi. Pairing asks for the same code on both screens.</p>
          </section>
        )}

        <section aria-labelledby="by-ip-title" className="mt-9">
          <h2 id="by-ip-title" className="px-4 text-[13px] font-normal uppercase tracking-wide text-muted">
            Not listed?
          </h2>
          <div className="clay mt-2 rounded-[24px] bg-raised px-4 py-3.5">
            <AddHost hosts={device.hosts} ips={device.ips} onChange={refreshDevice} self={device.info.os === "ios" ? "This device" : "This phone"} bare />
          </div>
        </section>
      </div>
      <PairPrompt selfSeed={device.info.fingerprint} />
      {prompt && update.available && <UpdatePrompt update={update} seed={device.info.fingerprint} downloadUrl={apk} onClose={() => setPrompt(false)} />}
    </main>
  );
}

/** One action on a computer's card, a clay key: an icon over a short label, in the accent, the warm orange or plain. */
function Tile({ icon, label, tone, disabled, onClick }: { icon: React.ReactNode; label: string; tone?: "accent" | "warm"; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={
        "clay-key flex min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-[20px] text-[13px] font-semibold transition-[transform,opacity] duration-150 active:translate-y-0.5 active:scale-[0.97] disabled:opacity-40 " +
        (tone === "accent" ? "bg-accent text-on-accent" : tone === "warm" ? "bg-[var(--color-warm)] text-white" : "bg-sunken text-fg")
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

const SIDES: Edge[] = ["left", "top", "bottom", "right"];

/** Whether paired computers can move into this phone, which side of the computer it sits on, and the way to set it up.
 *  `fresh`: a computer was just paired, so the setup is what to do next. */
function ControlCard({ device, computer, control, fresh, onSetup, onChange }: { device: Device; computer: PairedDevice; control: Control; fresh: boolean; onSetup: () => void; onChange: () => void }) {
  const [placeNote, setPlaceNote] = useState("");
  const setup = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!fresh) return;
    setup.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    setup.current?.focus({ preventScroll: true });
  }, [fresh, control.status?.running]);
  const s = control.status;
  if (!s) return null;
  const { alias, fingerprint } = computer;
  // the phone's portal edge faces the computer: sitting left of it, the computer is off the phone's right edge
  const edge = device.portals[fingerprint]?.edge;
  const side = edge ? opposite[edge] : null;
  const place = async (where: Edge) => {
    const monitor = { x: 0, y: 0, w: Math.round(screen.width * devicePixelRatio), h: Math.round(screen.height * devicePixelRatio) };
    const portal: Portal = { edge: opposite[where], monitor, start: 0, end: 1, reach: REACH };
    try {
      setPlaceNote((await invoke<string | null>("set_portal", { fingerprint, portal, sync: true })) ?? "");
    } catch (e) {
      setPlaceNote(String(e));
    }
    onChange();
  };
  if (s.running)
    return (
      <div className="mt-6 clay rounded-[24px] bg-raised p-4">
        <p className="text-sm text-muted">
          <span className="font-semibold text-fg">{alias} can move into this phone.</span> Push its cursor past the side this phone sits on.
        </p>
        <p id="side-label" className="mt-3 text-xs text-muted">
          This phone sits on {alias}'s
        </p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="side-label">
          {SIDES.map((w) => (
            <button
              key={w}
              aria-pressed={side === w}
              onClick={() => place(w)}
              className={"clay-key min-h-11 rounded-full px-4 text-sm capitalize transition-colors " + (side === w ? "bg-accent font-semibold text-on-accent" : "bg-raised text-fg")}
            >
              {w}
            </button>
          ))}
        </div>
        <p role="status" className="mt-2 min-h-4 text-xs text-muted">
          {placeNote}
        </p>
        <Battery control={control} />
      </div>
    );
  // iOS lets no app inject input, so there is no setup that would let a computer move in
  if (device.info.os === "ios")
    return (
      <div className="mt-6 clay rounded-[24px] bg-raised p-4">
        <p className="font-semibold">{alias} can't move into this {device.info.deviceType === "mobile" ? "iPhone or iPad" : "device"}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">iOS doesn't let apps move the cursor or type. The touchpad, clipboard and Send files work.</p>
      </div>
    );
  return (
    <div className={"clay mt-6 rounded-[24px] bg-raised p-4 transition-shadow " + (fresh ? "outline-2 outline-accent" : "")}>
      <p className="font-semibold">{s.paired ? `${alias} can't move into this phone right now` : `${alias} can't move into this phone yet`}</p>
      <p className={"mt-1 text-sm leading-relaxed " + (control.error ? "text-danger" : "text-muted")}>
        {s.paired
          ? (control.error ?? "Starting…")
          : "Touchpad and Send files already work. To let its cursor move in past the screen edge, do the one-time setup in Android settings."}
      </p>
      <button ref={setup} onClick={s.paired && control.error ? control.retry : onSetup} className={(fresh ? primaryButton : quietButton + " text-fg") + " mt-3 min-h-11"}>
        {s.paired && control.error ? "Try again" : "Set up"}
      </button>
      <Battery control={control} />
    </div>
  );
}

/** Android's battery optimisation may stop TCuFlow in the background, and with it every way in. */
function Battery({ control, className = "mt-3 border-t border-line pt-3" }: { control: Control; className?: string }) {
  if (!control.status || control.status.batteryExempt) return null;
  // back from Android's dialog, useControl's visibilitychange refresh picks up the answer
  const allow = () => invoke("plugin:tcuflow|exemptBattery").then(control.refresh, () => {});
  return (
    <div className={"flex items-center gap-3 " + className}>
      <p className="flex-1 text-sm text-muted">Android may close TCuFlow in the background</p>
      <button onClick={allow} className={quietButton + " min-h-11 text-fg"}>
        Allow
      </button>
    </div>
  );
}

function Settings({ device, control, update, onSetup, onAbout, onClose, onChange }: {
  device: Device;
  control: Control;
  update: Update;
  onSetup: () => void;
  onAbout: () => void;
  onClose: () => void;
  onChange: () => void;
}) {
  const s = control.status;
  return (
    <main className="mx-auto min-h-full w-full max-w-xl px-5 pb-10 pt-[max(env(safe-area-inset-top),1rem)]">
      <header className="flex items-center gap-3">
        <button onClick={onClose} aria-label="Back" className="clay grid h-10 w-10 place-items-center rounded-full bg-raised text-fg active:scale-95">
          <ChevronLeftIcon size={20} />
        </button>
        <h1 className="text-[22px] font-bold tracking-[-0.01em]">Settings</h1>
      </header>

      <p className="mt-6 px-1 text-xs text-muted">Computers controlling this phone</p>
      <div className="mt-2 flex items-center gap-3 clay rounded-[20px] bg-raised p-4">
        <p className="flex-1 text-sm">
          {!s ? "Not available" : s.running ? "On: paired computers can move in" : s.paired ? (control.error ?? "Starting…") : "Not set up"}
        </p>
        <button onClick={onSetup} className={quietButton + " min-h-11"}>
          {s?.paired ? "Set up again" : "Set up"}
        </button>
      </div>
      <Battery control={control} className="mt-2 clay rounded-[20px] bg-raised p-4" />

      <p className="mt-6 px-1 text-xs text-muted">Received files</p>
      <p className="mt-2 break-all clay-dip rounded-[20px] bg-sunken p-4 font-mono text-xs text-muted">{device.received}</p>

      <p className="mt-6 px-1 text-xs text-muted">Paired</p>
      {device.paired.length === 0 ? (
        <p className="mt-2 px-1 text-sm text-faint">No computers yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line clay overflow-hidden rounded-[20px] bg-raised">
          {device.paired.map((d) => (
            <li key={d.fingerprint} className="flex items-center gap-3 p-3 pl-4">
              <Face seed={d.fingerprint} size={32} />
              <p className="min-w-0 flex-1 truncate">{d.alias}</p>
              <button onClick={() => invoke("unpair", { fingerprint: d.fingerprint }).then(onChange)} className={quietButton + " min-h-11"}>
                Unpair
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={onAbout}
        className="mt-6 flex min-h-11 w-full items-center gap-3 clay rounded-[20px] bg-raised p-4 text-left transition-colors hover:bg-tint/[0.04] focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex-1 text-sm font-medium">About TCuFlow</span>
        {update.available && <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />}
        <span className="text-xs text-muted">{update.available ? `${update.available.name} available` : update.current ? `Version ${update.current}` : ""}</span>
      </button>
    </main>
  );
}

// PC/AT set-1 scancodes of the US layout, row by row; the shifted characters sit at the same index
const PLAIN = "1234567890-=qwertyuiop[]asdfghjkl;'`\\zxcvbnm,./";
const SHIFTED = '!@#$%^&*()_+QWERTYUIOP{}ASDFGHJKL:"~|ZXCVBNM<>?';
const ROW_START = [0x02, 0x10, 0x1e, 0x2b];
const SHIFT = 0x2a;
const ENTER = 0x1c;
const BACKSPACE = 0x0e;

/** The key (and whether Shift is needed) that types `ch`. */
function scanOf(ch: string): [number, boolean] | null {
  if (ch === " ") return [0x39, false];
  if (ch === "\n") return [ENTER, false];
  for (const [chars, shift] of [[PLAIN, false], [SHIFTED, true]] as const) {
    const i = chars.indexOf(ch);
    if (i >= 0) return [ROW_START[Math.floor(i / 12)] + (i % 12), shift];
  }
  return null;
}

type Input =
  | { type: "move"; dx: number; dy: number }
  | { type: "button"; button: number; down: boolean }
  | { type: "wheel"; dx: number; dy: number }
  | { type: "key"; scan: number; down: boolean }
  | { type: "text"; text: string };
const send = (event: Input) => invoke("touch", { event });
const tapKey = (scan: number, shift = false) => {
  if (shift) send({ type: "key", scan: SHIFT, down: true });
  send({ type: "key", scan, down: true });
  send({ type: "key", scan, down: false });
  if (shift) send({ type: "key", scan: SHIFT, down: false });
};
const click = (button: number) => {
  send({ type: "button", button, down: true });
  send({ type: "button", button, down: false });
};
/** Types `text` on the computer: as text when it takes any character (its own layout can't garble it), else as US keys. Line breaks are Enter. */
const typeText = (text: string, asText: boolean) =>
  text.split("\n").forEach((line, i) => {
    if (i) tapKey(ENTER);
    if (!line) return;
    if (asText) send({ type: "text", text: line });
    else
      for (const ch of line) {
        const k = scanOf(ch);
        if (k) tapKey(...k);
      }
  });

/** Cursor px per CSS px of finger travel. */
const SPEED = 2.5;
/** Finger travel (CSS px) per wheel notch. */
const NOTCH = 30;

type Session = { state: "connecting" } | { state: "on" } | { state: "back" } | { state: "error"; message: string };

/** The phone as touchpad and keyboard of computer `peer`: one finger moves, two scroll, a tap clicks (two fingers: right click). */
function Touchpad({ peer, onClose }: { peer: Peer; onClose: () => void }) {
  const [session, setSession] = useState<Session>({ state: "connecting" });
  const [typing, setTyping] = useState(false);
  const keys = useRef<HTMLTextAreaElement>(null);
  /** what the box held after the last input */
  const box = useRef(" ");
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ start: 0, moved: 0, most: 0, rest: { x: 0, y: 0, wheel: 0 } });
  const fp = peer.info.fingerprint;

  const start = () => {
    setSession({ state: "connecting" });
    invoke("control", { fingerprint: fp }).catch((e) => setSession({ state: "error", message: String(e) }));
  };

  useEffect(() => {
    const un = listen<{ active: boolean; error?: string | null }>("kvm", ({ payload: e }) =>
      setSession(e.active ? { state: "on" } : e.error ? { state: "error", message: e.error } : { state: "back" }),
    );
    un.then(start);
    return () => {
      un.then((f) => f());
      invoke("disconnect");
    };
  }, [fp]);

  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = fingers.current;
    if (f.size === 0) gesture.current = { start: e.timeStamp, moved: 0, most: 0, rest: { x: 0, y: 0, wheel: 0 } };
    f.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current.most = Math.max(gesture.current.most, f.size);
  };

  const move = (e: React.PointerEvent) => {
    const f = fingers.current;
    const last = f.get(e.pointerId);
    if (!last) return;
    const [dx, dy] = [e.clientX - last.x, e.clientY - last.y];
    f.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    g.moved += Math.hypot(dx, dy);
    const r = g.rest;
    if (f.size === 1) {
      // sub-pixel rests carry over so slow strokes still move
      r.x += dx * SPEED;
      r.y += dy * SPEED;
      const [mx, my] = [Math.trunc(r.x), Math.trunc(r.y)];
      r.x -= mx;
      r.y -= my;
      if (mx || my) send({ type: "move", dx: mx, dy: my });
    } else if (e.pointerId === f.keys().next().value) {
      // two fingers scroll, natural direction (content follows the fingers); one finger's motion is enough
      r.wheel += (dy / NOTCH) * 120;
      const w = Math.trunc(r.wheel);
      r.wheel -= w;
      if (w) send({ type: "wheel", dx: 0, dy: w });
    }
  };

  const up = (e: React.PointerEvent) => {
    const f = fingers.current;
    f.delete(e.pointerId);
    const g = gesture.current;
    if (f.size === 0 && g.moved < 12 && e.timeStamp - g.start < 250) click(g.most >= 2 ? 2 : 1);
  };

  const typed = (e: React.FormEvent<HTMLTextAreaElement>) => {
    // the box starts as one space, so Backspace still shows on an "empty" box. What changed since the last input
    // goes out: removed characters as Backspace, new ones as typed text (so IME words, autocorrect and emoji work)
    const t = e.currentTarget;
    const [v, old] = [t.value, box.current];
    let p = 0;
    while (p < old.length && p < v.length && old[p] === v[p]) p++;
    if (p > 0 && /[\uD800-\uDBFF]/.test(old[p - 1])) p--; // never half an emoji
    for (const _ of old.slice(p)) tapKey(BACKSPACE);
    typeText(v.slice(p), peer.info.text === true);
    // a word still being composed stays in the box, so the keyboard can keep changing it
    if ((e.nativeEvent as InputEvent).isComposing) box.current = v;
    else t.value = box.current = " ";
  };

  const toggleKeys = () => {
    const t = keys.current!;
    if (typing) t.blur();
    else {
      t.value = box.current = " ";
      t.focus();
    }
    setTyping(!typing);
  };

  const hold = (button: number) => ({
    onPointerDown: () => send({ type: "button", button, down: true }),
    onPointerUp: () => send({ type: "button", button, down: false }),
    onPointerCancel: () => send({ type: "button", button, down: false }),
  });

  const status =
    session.state === "on" ? null : session.state === "connecting" ? "Connecting…" : session.state === "back" ? `${peer.info.alias} took its cursor back` : session.message;

  const { light } = clayOf(fp);
  const live = session.state === "on";
  return (
    <main className="flex h-full flex-col px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),1rem)]">
      <header className="flex items-center gap-3">
        <button onClick={onClose} aria-label="Back" className="clay grid h-10 w-10 place-items-center rounded-full bg-raised text-fg active:scale-95">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="rounded-type truncate text-[18px] font-semibold">{peer.info.alias}</p>
          <p className="flex items-center gap-1.5 text-[13px] text-muted">
            <span aria-hidden className={`h-2 w-2 rounded-full ${live ? "bg-success" : session.state === "connecting" ? "animate-pulse bg-warning" : "bg-faint/60"}`} />
            {live ? "Connected" : session.state === "connecting" ? "Connecting…" : "Not connected"}
          </p>
        </div>
      </header>

      {/* the pad and its two buttons, one piece, like a laptop's trackpad */}
      <div className="clay mt-4 flex min-h-0 flex-1 flex-col gap-2.5 rounded-[34px] bg-raised p-2.5">
        <div
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className="clay-dip relative grid flex-1 touch-none select-none place-items-center rounded-[26px] bg-sunken"
          style={{
            backgroundImage: `radial-gradient(110% 80% at 50% 0%, ${light}55, transparent 70%), radial-gradient(circle, color-mix(in oklab, var(--color-fg) 10%, transparent) 1px, transparent 1.5px)`,
            backgroundSize: "auto, 22px 22px",
          }}
        >
          {status ? (
            <div className="px-8 text-center" role="status">
              <p className={"text-[17px] " + (session.state === "error" ? "text-danger" : "text-muted")}>{status}</p>
              {session.state !== "connecting" && (
                <button onPointerDown={(e) => e.stopPropagation()} onClick={start} className={primaryButton + " mt-4 min-h-11 rounded-full px-6"}>
                  Control again
                </button>
              )}
            </div>
          ) : (
            <ul className="pointer-events-none space-y-2 text-center text-[15px] text-faint">
              <li>One finger moves</li>
              <li>Two fingers scroll</li>
              <li>Tap to click</li>
            </ul>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button {...hold(1)} className="clay-key min-h-16 touch-none rounded-[22px] bg-raised text-[15px] font-semibold text-fg transition-transform active:translate-y-0.5">
            Left click
          </button>
          <button {...hold(2)} className="clay-key min-h-16 touch-none rounded-[22px] bg-raised text-[15px] font-semibold text-fg transition-transform active:translate-y-0.5">
            Right click
          </button>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={toggleKeys}
          aria-pressed={typing}
          className={"clay-key flex min-h-13 flex-1 items-center justify-center gap-2 rounded-full text-[16px] font-semibold transition-colors " + (typing ? "bg-accent text-on-accent" : "bg-raised text-fg")}
        >
          <KeyboardIcon size={20} />
          Keyboard
        </button>
        <button onClick={onClose} className="clay-key min-h-13 rounded-full bg-[var(--color-warm)] px-7 text-[16px] font-semibold text-white">
          Stop
        </button>
      </div>
      {/* off-screen box the Android keyboard types into; its text goes out as key presses */}
      <textarea
        ref={keys}
        onInput={typed}
        onBlur={() => setTyping(false)}
        aria-label="Type on the computer"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="fixed -left-[200vw] top-1/2 h-10 w-40 opacity-0"
      />
    </main>
  );
}
