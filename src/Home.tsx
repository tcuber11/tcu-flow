// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Menu, type MenuItemOptions, type PredefinedMenuItemOptions } from "@tauri-apps/api/menu";
import { message, open } from "@tauri-apps/plugin-dialog";
import { About, useUpdate } from "./About";
import { UpdatePrompt } from "./UpdatePrompt";
import { Calibrate } from "./Calibrate";
import { Face } from "./Face";
import { Badge, CodeBoxes, ConnectionCheck, StateBadge, StateNote, Troubleshoot, deviceState, linkButton, osLabel, primaryButton, quietButton, stateReason, usePairRequest, type Device, type Peer } from "./Pairing";
import { CheckIcon, ClockIcon, CloseIcon, DisplayIcon, IncomingIcon, LinkIcon, MoonIcon, PlusCircleIcon, SunIcon, WavesIcon } from "./icons";
import { THEMES, type Theme, loadTheme, saveTheme } from "./theme";
import { emit } from "@tauri-apps/api/event";
import { ClipHistory } from "./ClipHistory";
import { Outbox } from "./Outbox";
import { Pointer } from "./Pointer";
import { Sharing } from "./Sharing";
import { Transfers } from "./Transfers";

const SELECTED_KEY = "tcuflow.selected";

const THEME_ICON: Record<Theme, React.ReactNode> = { system: <DisplayIcon size={15} />, light: <SunIcon size={15} />, dark: <MoonIcon size={15} /> };
const THEME_LABEL: Record<Theme, string> = { system: "Match system appearance", light: "Light appearance", dark: "Dark appearance" };

/** System / Light / Dark, as a three-way segmented control. */
function AppearancePicker() {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const pick = (t: Theme) => {
    setTheme(t);
    saveTheme(t);
    emit("theme", t); // the other TCuFlow windows follow
  };
  return (
    <div role="radiogroup" aria-label="Appearance" className="flex rounded-lg bg-tint/[0.06] p-0.5">
      {THEMES.map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={theme === t}
          aria-label={THEME_LABEL[t]}
          title={THEME_LABEL[t]}
          onClick={() => pick(t)}
          className="grid h-7 w-8 place-items-center rounded-md text-muted transition-[background-color,color,box-shadow] duration-150 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent aria-checked:bg-raised aria-checked:text-fg aria-checked:shadow-[0_1px_2px_rgb(0_0_0/0.12)]"
        >
          {THEME_ICON[t]}
        </button>
      ))}
    </div>
  );
}

const kindOf = (p: Peer) => (p.info.deviceType === "mobile" ? "phone" : "computer");

export function Home() {
  const [device, setDevice] = useState<Device | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [about, setAbout] = useState(false);
  // the update popup shows once per launch; "Later" keeps it away until TCuFlow starts again
  const [prompt, setPrompt] = useState(true);
  const update = useUpdate();
  const refreshDevice = () => invoke<Device>("get_device").then(setDevice);

  useEffect(() => {
    const refreshPeers = () => invoke<Peer[]>("peers").then(setPeers);
    refreshDevice();
    // subscribe before the first fetch so nothing announced in between is missed
    const unPeer = listen("peer", refreshPeers);
    unPeer.then(refreshPeers);
    const unPaired = listen("paired", refreshDevice);
    const unDevice = listen("device", refreshDevice);
    const unAbout = listen("about", () => setAbout(true)); // tray menu
    const prune = setInterval(refreshPeers, 5000); // devices that went quiet drop off
    return () => {
      unPeer.then((f) => f());
      unPaired.then((f) => f());
      unDevice.then((f) => f());
      unAbout.then((f) => f());
      clearInterval(prune);
    };
  }, []);

  if (!device) return null;
  const { alias, fingerprint } = device.info;

  return (
    <main className="mx-auto flex min-h-full max-w-[720px] flex-col px-8 pb-8 pt-5">
      <header className="flex items-center gap-3">
        <Face seed={fingerprint} size={30} kind={device.info.deviceType === "mobile" ? "phone" : "computer"} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold">{alias}</p>
          <p className="text-xs text-muted">This computer</p>
        </div>
        <AppearancePicker />
        <button
          onClick={() => setAbout(true)}
          aria-label={update.available ? `About TCuFlow, ${update.available.name} available` : "About TCuFlow"}
          className={`${quietButton} relative`}
        >
          About
          {update.available && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-ink" />}
        </button>
      </header>
      <Devices device={device} peers={peers} onChange={refreshDevice} />
      <Sharing key={String(device.sharing.folder)} initial={device.sharing} received={device.received} mac={device.info.os === "macos"} onChange={refreshDevice} />
      <ClipHistory />
      <Transfers />
      {import.meta.env.DEV && (
        <footer className="mt-auto flex justify-end pt-10">
          <button onClick={() => invoke("start_sim")} className="text-xs text-faint underline-offset-2 hover:text-muted hover:underline focus-visible:outline-2 focus-visible:outline-accent">
            Developer: open phone simulator
          </button>
        </footer>
      )}

      <Outbox device={device} peers={peers} />
      {about && <About update={update} seed={fingerprint} os={device.info.os} onClose={() => setAbout(false)} onUpdate={() => (setAbout(false), setPrompt(true))} />}
      {prompt && !about && (update.installable || update.available) && <UpdatePrompt update={update} seed={fingerprint} onClose={() => setPrompt(false)} />}
    </main>
  );
}

type PairAnswer = "accepted" | "declined" | "noAnswer" | "unknown";
type PairState = { state: "waiting"; code?: string } | { state: Exclude<PairAnswer, "accepted"> } | { state: "error"; message: string };

/** Every TCuFlow nearby. Any of them can be paired and placed around this computer's screens; any paired one can drive this one too. */
function Devices({ device, peers, onChange }: { device: Device; peers: Peer[]; onChange: () => void }) {
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(SELECTED_KEY));
  const [pairing, setPairing] = useState<Record<string, PairState>>({});
  const [kvm, setKvm] = useState<{ active: boolean; error?: string | null; device?: string }>({ active: false });
  const [locked, setLocked] = useState(false);
  const mac = device.info.os === "macos";

  useEffect(() => {
    const un = listen<{ active: boolean; error?: string | null; device?: string }>("kvm", (e) => setKvm(e.payload));
    const unLock = listen<boolean>("lock", (e) => setLocked(e.payload));
    // the requester's half of the pairing code arrives once both nonces are exchanged
    const unCode = listen<{ fingerprint: string; code: string }>("pair-code", ({ payload: { fingerprint: f, code } }) =>
      setPairing((s) => (s[f]?.state === "waiting" ? { ...s, [f]: { state: "waiting", code } } : s)),
    );
    return () => {
      un.then((f) => f());
      unLock.then((f) => f());
      unCode.then((f) => f());
    };
  }, []);

  // a failed crossing is news for a moment, not a state: it goes by itself (or with its ×)
  const dismiss = () => setKvm((k) => ({ ...k, error: null }));
  useEffect(() => {
    if (!kvm.error) return;
    const t = setTimeout(dismiss, 8000);
    return () => clearTimeout(t);
  }, [kvm.error]);

  const isPaired = (f: string) => device.paired.some((p) => p.fingerprint === f);
  const stateOf = (p: Peer) => deviceState(p, isPaired(p.info.fingerprint), device.info);
  const outdated = (p: Peer) => stateOf(p) === "update";
  const select = (f: string | null) => {
    setSelected(f);
    if (f) localStorage.setItem(SELECTED_KEY, f);
    else localStorage.removeItem(SELECTED_KEY);
  };

  const offlinePaired = device.paired.filter((p) => !peers.some((c) => c.info.fingerprint === p.fingerprint));
  const current = peers.find((c) => c.info.fingerprint === selected && isPaired(selected) && !outdated(c));
  const selPeer = peers.find((c) => c.info.fingerprint === selected);
  const selState = deviceState(selPeer, true, device.info);
  const placed = (f: string) => f in device.portals;

  /** Resolves with whether the other device accepted. */
  const pair = async (p: Peer) => {
    const f = p.info.fingerprint;
    setPairing((s) => ({ ...s, [f]: { state: "waiting" } }));
    try {
      const answer = await invoke<PairAnswer>("pair", { fingerprint: f });
      setPairing(({ [f]: _, ...rest }) => (answer === "accepted" ? rest : { ...rest, [f]: { state: answer } }));
      if (answer === "accepted") select(f);
      return answer === "accepted";
    } catch (e) {
      setPairing((s) => ({ ...s, [f]: { state: "error", message: String(e) } }));
      return false;
    }
  };

  /** The status pill a nearby device shows. */
  const status = (p: Peer): React.ReactNode => {
    const f = p.info.fingerprint;
    const st = pairing[f];
    if (stateOf(p) !== "ready") return <StateBadge state={stateOf(p)} />;
    if (st?.state === "waiting") return <Badge tone="accent" icon={<ClockIcon size={14} />}>Waiting</Badge>;
    if (isPaired(f)) return <Badge tone="success" icon={<LinkIcon size={14} />}>{placed(f) ? "Linked" : "Linked · place it"}</Badge>;
    if (st?.state === "declined") return <Badge tone="danger">Declined</Badge>;
    if (st?.state === "noAnswer") return <Badge tone="danger">No answer</Badge>;
    if (st?.state === "unknown") return <Badge tone="danger">Can't see this computer</Badge>;
    if (st?.state === "error") return <Badge tone="danger">Couldn't reach it</Badge>;
    return null;
  };

  /** Right-click on a device: the OS's own menu with what can be done to it right now. */
  const menu = async (e: React.MouseEvent, items: (MenuItemOptions | PredefinedMenuItemOptions | false)[]) => {
    e.preventDefault();
    const m = await Menu.new({ items: items.filter((i) => i !== false) });
    await m.popup();
  };
  const sendFiles = async (f: string) => {
    const paths = await open({ multiple: true });
    if (paths?.length) invoke("send_paths", { fingerprint: f, paths }).catch((err) => message(String(err), { title: "Couldn't send", kind: "error" }));
  };
  const unpair = (f: string) => {
    invoke("unpair", { fingerprint: f });
    if (selected === f) select(null);
  };
  const peerMenu = (p: Peer): (MenuItemOptions | PredefinedMenuItemOptions | false)[] => {
    const f = p.info.fingerprint;
    if (outdated(p)) return [{ text: "Needs a TCuFlow update", enabled: false }];
    if (!isPaired(f)) return [{ text: "Pair…", enabled: pairing[f]?.state !== "waiting", action: () => void pair(p) }];
    return [
      { text: stateOf(p) === "setup" ? `Control: finish setup on ${p.info.alias}` : "Control", enabled: placed(f) && stateOf(p) === "ready", action: () => void invoke("control", { fingerprint: f }) },
      { text: "Send files…", action: () => void sendFiles(f) },
      placed(f) && { text: "Take off screens", action: () => void invoke("set_portal", { fingerprint: f, portal: null, sync: true }).then(onChange) },
      { item: "Separator" },
      { text: "Unlink", action: () => unpair(f) },
    ];
  };

  const { req: incoming, answer } = usePairRequest();
  const listed = peers.filter((p) => p.info.fingerprint !== incoming?.peer.info.fingerprint);
  const empty = peers.length === 0 && offlinePaired.length === 0 && !incoming;
  const linkedCount = device.paired.length;
  const nearbyCount = peers.length + (incoming && !peers.some((p) => p.info.fingerprint === incoming.peer.info.fingerprint) ? 1 : 0);
  const waiting = Object.values(pairing).find((s) => s.state === "waiting");
  const waitingCode = waiting?.state === "waiting" ? waiting.code : undefined;
  const unseen = peers.find((p) => pairing[p.info.fingerprint]?.state === "unknown");

  return (
    <>
      <section aria-labelledby="linked" className="mt-8">
        <div className="rise flex flex-wrap items-center justify-between gap-3">
          <h1 id="linked" className="text-[26px] font-bold leading-tight tracking-[-0.02em]">
            {current ? <>Linked with {current.info.alias}</> : "Linked computers"}
          </h1>
          <span className="inline-flex items-center gap-2 rounded-full bg-accent/12 px-3.5 py-1.5 text-sm font-medium text-accent-ink">
            {linkedCount ? <LinkIcon size={15} /> : <PlusCircleIcon size={15} className="text-accent" />}
            {linkedCount === 0 ? "No computers linked yet" : linkedCount === 1 ? "1 computer linked" : `${linkedCount} computers linked`}
          </span>
        </div>
        <p className="rise mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-muted" style={{ "--i": 1 } as React.CSSProperties}>
          {unseen
            ? `${unseen.info.alias} can't see this computer on the network. Check both are on the same network, or add this computer by IP there.`
            : current
              ? "Push your cursor off the glowing edge to move over, and back out the far side to come home. The other computer reaches this one the same way."
              : "Link another computer to share one keyboard, mouse and clipboard between them."}
        </p>

        <div className="rise mt-5 rounded-2xl border border-line bg-raised p-5" style={{ "--i": 2 } as React.CSSProperties}>
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Discovery</h2>
          <p className="mt-2 flex items-center gap-2 text-sm text-accent-ink">
            <span style={{ animation: "listen 2.4s ease-in-out infinite" }}>
              <WavesIcon size={17} />
            </span>
            Looking for computers running TCuFlow on this network.
          </p>
          {(incoming || waiting) && <p className="mt-4 text-sm font-medium text-muted">Make sure the security code matches on your other computer before accepting.</p>}

          {waiting && (
            <div role="status" className="mt-3 rounded-xl border border-line p-4" style={{ animation: "sheet-in 0.3s var(--ease-out-soft)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-muted">Security code</span>
                <span className="text-xs text-muted">{waitingCode ? `Accept on ${peers.find((p) => pairing[p.info.fingerprint]?.state === "waiting")?.info.alias ?? "the other computer"} if it shows this code` : `Asking ${peers.find((p) => pairing[p.info.fingerprint]?.state === "waiting")?.info.alias ?? "the other computer"}…`}</span>
              </div>
              <div className="mt-3 min-h-14">{waitingCode ? <CodeBoxes code={waitingCode} /> : <p className="pt-4 text-sm text-faint">The code appears once both computers have answered.</p>}</div>
            </div>
          )}

          <div className="mt-6 flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold">Nearby computers</h3>
            <span className="text-sm tabular-nums text-muted">{nearbyCount === 1 ? "1 computer" : `${nearbyCount} computers`}</span>
          </div>

          <ul className="mt-3 flex flex-col gap-2.5">
            {incoming && (
              <li className="rounded-xl border border-line p-4" style={{ animation: "sheet-in 0.3s var(--ease-out-soft)" }}>
                <div className="flex items-start gap-4">
                  <Face seed={incoming.peer.info.fingerprint} size={52} kind={kindOf(incoming.peer)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="truncate text-[17px] font-semibold">{incoming.peer.info.alias}</p>
                      <Badge tone="warning" icon={<IncomingIcon size={14} />}>
                        Incoming
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {osLabel(incoming.peer.info.os)} · {incoming.peer.addr}
                    </p>
                    <p className="mt-1 text-sm text-fg">Wants to control this computer and send it files.</p>
                    <p className="mt-3 text-sm text-muted">Security code</p>
                    <div className="mt-2">
                      <CodeBoxes code={incoming.code} />
                    </div>
                    <div className="mt-3.5 flex gap-2">
                      <button onClick={() => answer(true)} className={primaryButton + " min-w-24"}>
                        Accept
                      </button>
                      {/* default focus on the safe choice: a stray Enter must not hand over control */}
                      <button autoFocus onClick={() => answer(false)} className={quietButton + " min-w-24 focus:outline-none focus-visible:outline-2"}>
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            )}
            {listed.map((p) => {
              const f = p.info.fingerprint;
              const paired = isPaired(f);
              const active = selected === f && paired;
              const st = pairing[f];
              const asking = st?.state === "waiting";
              return (
                // on the <li>: a disabled button (waiting, outdated) gets no mouse events at all
                <li
                  key={f}
                  onContextMenu={(e) => menu(e, peerMenu(p))}
                  className={`rounded-xl border p-4 transition-[border-color,box-shadow] duration-200 ${active ? "border-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_18%,transparent)]" : "border-line"}`}
                >
                  <div className="flex items-center gap-4">
                    <Face seed={f} size={52} kind={kindOf(p)} mood={asking ? "waiting" : st || outdated(p) ? "sad" : "idle"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate text-[17px] font-semibold">{p.info.alias}</p>
                        {status(p)}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {osLabel(p.info.os)} · {p.addr}
                        {stateOf(p) !== "ready" && <> · {stateReason(stateOf(p), p.info.alias, p.info.os)}</>}
                      </p>
                      {asking && st.code && (
                        <div className="mt-2.5 flex items-center gap-3">
                          <span className="text-sm text-muted">Security code</span>
                          <CodeBoxes code={st.code} size="sm" />
                        </div>
                      )}
                      {!asking && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {paired ? (
                            <button onClick={() => select(active ? null : f)} aria-pressed={active} className={quietButton}>
                              {active ? (
                                <>
                                  <CheckIcon size={14} /> Selected
                                </>
                              ) : (
                                "Select"
                              )}
                            </button>
                          ) : (
                            <button disabled={outdated(p)} onClick={() => void pair(p)} className={primaryButton}>
                              {st ? "Try again" : "Link"}
                            </button>
                          )}
                          {paired && (
                            <button onClick={() => unpair(f)} className={quietButton}>
                              Unlink
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            {offlinePaired.map((p) => (
              <li
                key={p.fingerprint}
                onContextMenu={(e) =>
                  menu(e, [device.wakeable.includes(p.fingerprint) && { text: "Wake up", action: () => void invoke("wake", { fingerprint: p.fingerprint }) }, { text: "Forget", action: () => unpair(p.fingerprint) }])
                }
                className="flex items-center gap-4 rounded-xl border border-line p-4"
              >
                <Face seed={p.fingerprint} size={52} mood="sad" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="truncate text-[17px] font-semibold text-muted">{p.alias}</p>
                    <StateBadge state="offline" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {device.wakeable.includes(p.fingerprint) && (
                      <button onClick={() => invoke("wake", { fingerprint: p.fingerprint })} className={linkButton}>
                        Wake up
                      </button>
                    )}
                    <button onClick={() => unpair(p.fingerprint)} className={linkButton + " text-danger"}>
                      Forget
                    </button>
                  </div>
                </div>
              </li>
            ))}
            {empty && (
              <li className="flex items-center gap-4 rounded-xl border border-dashed border-line p-4">
                <Face seed={device.info.fingerprint} size={52} mood="searching" />
                <div>
                  <p className="text-[15px] font-semibold">No computers found yet</p>
                  <p className="mt-0.5 text-sm text-muted">Open TCuFlow on the other computer, on the same network.</p>
                </div>
              </li>
            )}
          </ul>
          <AddHost hosts={device.hosts} ips={device.ips} onChange={onChange} />
        </div>
      </section>

      {!empty && <Calibrate device={device} peers={peers} selected={selected} onSelect={select} onPair={pair} onChange={onChange} />}

      {selected && isPaired(selected) && selState !== "ready" && (
        <div className="mt-6">
          <StateNote
            state={selState}
            alias={device.paired.find((d) => d.fingerprint === selected)!.alias}
            os={selPeer?.info.os}
            onWake={device.wakeable.includes(selected) ? () => void invoke("wake", { fingerprint: selected }) : undefined}
          />
        </div>
      )}
      {current && selected && (
        <>
          <Pointer initial={device.cursor} mac={mac} />
        </>
      )}
      {selected && isPaired(selected) && (
        <div className="mt-5 flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-start gap-3">
            <ConnectionCheck key={selected} fingerprint={selected} />
            <Troubleshoot key={"t" + selected} fingerprint={selected} alias={current?.info.alias ?? "that device"} />
          </div>
        </div>
      )}

      {/* status toast while input is on another device, locked, or why it couldn't move */}
      {(kvm.active || kvm.error || locked) && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-20 flex w-max max-w-[calc(100%-2.5rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-raised py-2 pl-2 pr-4 text-sm shadow-[0_8px_28px_rgb(0_0_0/0.18)]"
          style={{ animation: "sheet-in 0.4s var(--ease-out-expo)" }}
        >
          {kvm.active && kvm.device ? <Face seed={kvm.device} size={26} mood="happy" /> : <Face seed={kvm.error ? "error" : device.info.fingerprint} size={26} mood={kvm.error ? "sad" : "idle"} />}
          {kvm.active ? (
            <span>
              Using {peers.find((p) => p.info.fingerprint === kvm.device)?.info.alias ?? "the other device"}
              {locked && " · locked"} · <kbd className="rounded-md bg-tint/10 px-1.5 py-0.5 font-sans text-xs text-muted">{mac ? "⌃ ⌥ Esc" : "Ctrl Alt Esc"}</kbd> to return
            </span>
          ) : kvm.error ? (
            <>
              <span className="text-danger">Couldn't move over: {kvm.error}</span>
              <button
                onClick={dismiss}
                aria-label="Dismiss"
                className="-mr-2 grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-tint/[0.08] hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
              >
                <CloseIcon size={13} />
              </button>
            </>
          ) : (
            <span>
              Pointer locked here · <kbd className="rounded-md bg-tint/10 px-1.5 py-0.5 font-sans text-xs text-muted">{mac ? "F14" : "Scroll Lock"}</kbd> to release
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** Fallback for networks that drop discovery (guest Wi-Fi, client isolation): reach a device by its address. */
export function AddHost({ hosts, ips, onChange }: { hosts: string[]; ips: string[]; onChange: () => void }) {
  const [ip, setIp] = useState("");
  const [error, setError] = useState("");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    invoke("add_host", { ip }).then(
      () => {
        setIp("");
        setError("");
        onChange();
      },
      (err) => setError(String(err)),
    );
  };

  return (
    <div className="mt-5 border-t border-line pt-4 text-sm">
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <label htmlFor="add-ip" className="mr-1 text-muted">
          Not showing up? Add by IP
        </label>
        <input
          id="add-ip"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="192.168.1.20"
          inputMode="decimal"
          spellCheck={false}
          aria-describedby={error ? "add-ip-error" : undefined}
          className="h-8 w-40 rounded-lg border border-line bg-sunken px-3 font-mono text-[13px] text-fg placeholder:text-faint focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-accent/25"
        />
        <button type="submit" disabled={!ip.trim()} className={quietButton}>
          Add
        </button>
      </form>
      {ips.length > 0 && (
        <p className="mt-2 text-xs text-faint">
          This computer's address: <span className="select-text font-mono text-fg">{ips.join(", ")}</span>
        </p>
      )}
      {error && (
        <p id="add-ip-error" role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      {hosts.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Added by IP">
          {hosts.map((h) => (
            <li key={h} className="flex items-center gap-1 rounded-full border border-line py-1 pl-3 pr-1 font-mono text-xs text-muted">
              {h}
              <button
                onClick={() => invoke("remove_host", { ip: h }).then(onChange)}
                aria-label={`Remove ${h}`}
                className="grid h-6 w-6 place-items-center rounded-full hover:bg-tint/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
              >
                <CloseIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
