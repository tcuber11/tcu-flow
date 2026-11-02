// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Mascot } from "./Mascot";
import type { Portal } from "./calibration";
import { CheckIcon, CloseIcon, RetryIcon } from "./icons";

/** `proto`: wire version (`kvm::PROTOCOL`); devices with another one can't pair or connect. `aspectRatio`: its screen's width / height.
 *  `controllable`: whether it can be driven right now (false: an Android phone not set up, a Linux without input access; absent on older TCuFlow = yes).
 *  `text`: it takes typed text whatever its keyboard layout (absent on older TCuFlow). */
export type DeviceInfo = { alias: string; deviceType: "desktop" | "mobile"; os: string; fingerprint: string; proto: number; aspectRatio: number; controllable?: boolean; text?: boolean };
export type Peer = { info: DeviceInfo; addr: string };
export type PairedDevice = { fingerprint: string; alias: string };
export type CursorPrefs = { speed: number; edgeDelayMs: number; swapCtrlCmd: boolean };
export type Sharing = { terminal: boolean; folder: string | null; sound: boolean; notifications: boolean; mic: boolean; screen: boolean };
export type Device = {
  info: DeviceInfo;
  paired: PairedDevice[];
  portals: Record<string, Portal>;
  ips: string[];
  hosts: string[];
  cursor: CursorPrefs;
  sharing: Sharing;
  received: string;
  wakeable: string[];
};

const OS_LABEL: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux", android: "Android", ios: "iOS", sim: "Simulator" };
export const osLabel = (os: string) => OS_LABEL[os] ?? os;

/** How to make a device drivable, per OS (`controllable: false`). */
export const setupHow = (os: string) =>
  os === "android"
    ? "On the phone: open TCuFlow → Set up"
    : os === "ios"
      ? "iPhones and iPads can't be controlled (iOS allows no input injection); use its touchpad instead"
      : os === "linux"
      ? "On it: About → Allow input access, or run sudo tcuflow --allow-input"
      : os === "macos"
        ? "On the Mac: TCuFlow → About → Allow Accessibility (again after each TCuFlow update)"
        : "Open TCuFlow there and follow its setup";

export type DeviceState = "ready" | "setup" | "offline" | "update";

/** Whether a device can be driven right now: the one check behind every badge, note and overlay. `peer` absent = not on the network;
 *  setup only matters once paired. */
export const deviceState = (peer: Peer | undefined, paired: boolean, me: DeviceInfo): DeviceState =>
  !peer ? "offline" : peer.info.proto !== me.proto ? "update" : paired && peer.info.controllable === false ? "setup" : "ready";

export const STATE_LABEL: Record<DeviceState, string> = { ready: "Ready", setup: "Needs setup", offline: "Offline", update: "Needs update" };

/** One line: why `alias` can't be driven and the fix (`os` for setup); `null` when ready. */
export const stateReason = (state: DeviceState, alias: string, os = "") =>
  state === "setup"
    ? `${alias} isn't ready. ${setupHow(os)}`
    : state === "update"
      ? `${alias} needs a TCuFlow update: install the newest TCuFlow on both devices`
      : state === "offline"
        ? `${alias} isn't on the network: turn it on and open TCuFlow there`
        : null;

export type Tone = "accent" | "warning" | "danger" | "success" | "neutral";
const TONE: Record<Tone, string> = {
  accent: "bg-accent/12 text-accent-ink",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  success: "bg-success/12 text-success",
  neutral: "bg-tint/[0.06] text-muted",
};

/** Status pill: tinted fill, text in the same hue, optional leading icon. Never colour alone: it always has words. */
export function Badge({ tone, icon, children }: { tone: Tone; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TONE[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

const STATE_TONE: Record<DeviceState, Tone> = { ready: "success", setup: "warning", update: "danger", offline: "neutral" };

/** Pill naming a blocked state or offline; `dot` for cramped spots, labelled for screen readers and on hover. */
export function StateBadge({ state, title, dot }: { state: DeviceState; title?: string | null; dot?: boolean }) {
  if (state === "ready") return null;
  const off = state === "offline";
  if (dot)
    return <span role="img" aria-label={STATE_LABEL[state]} title={title ?? STATE_LABEL[state]} className={`block h-2.5 w-2.5 rounded-full ring-2 ring-raised ${off ? "bg-muted" : state === "setup" ? "bg-warning" : "bg-danger"}`} />;
  return <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>;
}

/** A 6-digit pairing code, one box per digit, read out as separate digits. */
export function CodeBoxes({ code, size = "lg" }: { code: string; size?: "lg" | "sm" }) {
  const digits = code.replace(/\s/g, "").split("");
  if (size === "sm")
    return (
      <span aria-label={`Security code ${digits.join(" ")}`} className="rounded-full border border-line bg-raised px-3 py-1 text-sm font-semibold tabular-nums tracking-[0.08em] text-fg">
        {digits.join("")}
      </span>
    );
  return (
    <div role="img" aria-label={`Security code ${digits.join(" ")}`} className="flex gap-2">
      {digits.map((d, i) => (
        <span key={i} className="grid h-14 w-11 place-items-center rounded-xl border border-line bg-raised text-[28px] font-semibold tabular-nums text-fg" style={{ animation: `rise 0.4s ${i * 35}ms var(--ease-out-soft) both` }}>
          {d}
        </span>
      ))}
    </div>
  );
}

export type PairRequest = { id: number; peer: Peer; code: string };

/** The pairing request addressed to this window, if one is open, and the answer to it. */
export function usePairRequest() {
  const [req, setReq] = useState<PairRequest | null>(null);
  useEffect(() => {
    const win = getCurrentWebviewWindow(); // the simulated phone's prompts are its own
    const open = win.listen<PairRequest>("pair-request", (e) => setReq(e.payload));
    // the backend times requests out; drop it with them
    const closed = win.listen<number>("pair-request-closed", (e) => setReq((r) => (r?.id === e.payload ? null : r)));
    return () => {
      open.then((f) => f());
      closed.then((f) => f());
    };
  }, []);
  const answer = (accept: boolean) => {
    if (!req) return;
    invoke("answer_pair", { id: req.id, accept });
    setReq(null);
  };
  return { req, answer };
}

/** The selected device's state spelled out: badge, reason + fix, and Wake up when it's offline and wakeable. */
export function StateNote({ state, alias, os, onWake }: { state: DeviceState; alias: string; os?: string; onWake?: () => void }) {
  const reason = stateReason(state, alias, os);
  if (!reason) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-raised p-4 text-sm leading-relaxed">
      <StateBadge state={state} />
      <p className="min-w-0 flex-1 text-muted">{reason}.</p>
      {state === "offline" && onWake && (
        <button onClick={onWake} className={quietButton}>
          Wake up
        </button>
      )}
    </div>
  );
}

/** `check_device`: one QUIC probe per channel; `ms` = round trip. */
export type Probe = { ok: boolean; ms: number | null; error: string | null };
export type Check = { kvm: Probe; transfer: Probe; hint: string | null };

const probe = (name: string, p: Probe) => `${name}: ${p.ok ? `reached${p.ms != null ? ` in ${Math.round(p.ms)} ms` : ""}` : `not reached${p.error ? ` (${p.error})` : ""}`}`;

/** "Test connection" for a paired device: whether mouse/keyboard and files get through, and the likely fix when not. */
export function ConnectionCheck({ fingerprint }: { fingerprint: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Check | string | null>(null);
  const run = () => {
    setBusy(true);
    invoke<Check>("check_device", { fingerprint })
      .then(setResult, (e) => setResult(String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="min-w-0">
      <button onClick={run} disabled={busy} className={quietButton}>
        {busy ? "Testing…" : "Test connection"}
      </button>
      <div role="status" className="px-1 text-xs leading-relaxed text-muted">
        {typeof result === "string" ? (
          <p className="mt-2 text-danger">{result}</p>
        ) : result ? (
          <div className="mt-2 space-y-1">
            <p className={result.kvm.ok ? "" : "text-danger"}>{probe("Mouse and keyboard", result.kvm)}</p>
            <p className={result.transfer.ok ? "" : "text-danger"}>{probe("Files", result.transfer)}</p>
            {result.hint && <p className="text-fg">{result.hint}</p>}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** `troubleshoot`: one step of it; `fixed` = was wrong, put right on this computer. */
type Step = { title: string; result: "ok" | "fixed" | "failed"; detail: string };
const MARK = { ok: <CheckIcon size={13} />, fixed: <RetryIcon size={13} />, failed: <CloseIcon size={13} /> } as const;

/** "Troubleshoot" for a paired device: checks every reason the cursor might not cross, fixes what it can here,
 *  then crosses for real through the portal and back. */
export function Troubleshoot({ fingerprint, alias }: { fingerprint: string; alias: string }) {
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const run = () => {
    setBusy(true);
    setSteps(null);
    invoke<Step[]>("troubleshoot", { fingerprint })
      .then(setSteps, (e) => setSteps([{ title: "Troubleshoot", result: "failed", detail: String(e) }]))
      .finally(() => setBusy(false));
  };
  return (
    <div className="min-w-0">
      <button onClick={run} disabled={busy} className={quietButton}>
        {busy ? "Checking…" : "Troubleshoot"}
      </button>
      <div role="status" className="px-1 text-xs leading-relaxed text-muted">
        {busy && <p className="mt-2">Your cursor goes into {alias} for a moment and comes back.</p>}
        {steps && (
          <ul className="mt-2 space-y-1">
            {steps.map((s, i) => (
              <li key={i} className={`flex gap-1.5 ${s.result === "failed" ? "text-danger" : s.result === "fixed" ? "text-fg" : ""}`}>
                <span aria-hidden="true" className="mt-px shrink-0">{MARK[s.result]}</span>
                <span className="sr-only">{s.result}: </span>
                <span>
                  {s.title}: {s.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Primary action: system-blue filled button. */
export const primaryButton =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-on-accent transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
/** Secondary action: neutral filled button (Reject, Change…, Test connection). */
export const quietButton =
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-tint/[0.07] px-4 py-1.5 text-sm font-medium text-fg transition-[background-color,transform] duration-150 hover:bg-tint/[0.11] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
/** Text action in the accent (Refresh, Wake up). */
export const linkButton =
  "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

/** Accept/decline sheet for an incoming pairing request (phone views; the desktop shows it inline in its device list). */
export function PairPrompt({ selfSeed }: { selfSeed: string }) {
  const { req, answer } = usePairRequest();
  if (!req) return null;
  const { alias, fingerprint, os } = req.peer.info;

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/35 p-5" style={{ animation: "fade-in 0.2s ease-out" }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-title"
        aria-describedby="pair-body"
        className="w-full max-w-sm rounded-2xl bg-raised p-6 text-center shadow-[0_12px_40px_rgb(0_0_0/0.25)]"
        style={{ animation: "sheet-in 0.35s var(--ease-out-soft)" }}
      >
        <div className="flex items-center justify-center gap-3">
          <Mascot seed={fingerprint} size={56} mood="waiting" />
          <Mascot seed={selfSeed} size={56} mood="idle" />
        </div>
        <h2 id="pair-title" className="mt-5 text-xl font-semibold tracking-[-0.015em]">
          Link with {alias}?
        </h2>
        <p id="pair-body" className="mx-auto mt-2 max-w-[32ch] text-sm leading-relaxed text-muted">
          {alias} ({osLabel(os)}, {req.peer.addr}) will be able to use this device's mouse and keyboard and send it files. Accept only if it shows the same code.
        </p>
        <div className="mt-5 flex justify-center">
          <CodeBoxes code={req.code} />
        </div>
        <div className="mt-6 flex justify-center gap-2">
          {/* default focus on the safe choice: a stray Enter must not hand over control */}
          <button autoFocus onClick={() => answer(false)} className={quietButton + " min-w-24"}>
            Reject
          </button>
          <button onClick={() => answer(true)} className={primaryButton + " min-w-24"}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
