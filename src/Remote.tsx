// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
import { Suspense, lazy, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { quietButton } from "./Pairing";
import { Toggle } from "./Sharing";

// xterm is most of the app's code: fetched the first time a terminal opens, so launch doesn't pay for it
const Terminal = lazy(() => import("./Terminal").then((m) => ({ default: m.Terminal })));

type Stopped = { device: string; on: boolean; error?: string };

/** What this computer can use on the selected paired device (if that device shares it). */
export function Remote({ fingerprint, alias, mac }: { fingerprint: string; alias: string; mac: boolean }) {
  const [sound, setSound] = useState(false);
  const [mic, setMic] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // the backend stops them itself when the link drops or the other side stops sharing
    const offSound = listen<Stopped>("sound", (e) => {
      if (e.payload.device !== fingerprint) return;
      setSound(e.payload.on);
      if (e.payload.error) setError(e.payload.error);
    });
    const offMirror = listen<Stopped>("mirror", (e) => {
      if (e.payload.device !== fingerprint) return;
      setMirror(e.payload.on);
      if (e.payload.error) setError(e.payload.error);
    });
    const offMic = listen<Stopped>("mic", (e) => {
      if (e.payload.device !== fingerprint) return;
      setMic(e.payload.on);
      if (e.payload.error) setError(e.payload.error);
    });
    return () => {
      offSound.then((f) => f());
      offMirror.then((f) => f());
      offMic.then((f) => f());
    };
  }, [fingerprint]);

  const run = async (f: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
    return true;
  };
  const toggle = (cmd: string, set: (on: boolean) => void) => async (on: boolean) => {
    if (await run(() => invoke(cmd, { fingerprint, on }))) set(on);
  };
  // the virtual cable that turns played sound into a mic for call apps
  const cable = mac ? { name: "BlackHole", device: "BlackHole 2ch", url: "https://existential.audio/blackhole/" } : { name: "VB-CABLE", device: "CABLE Output", url: "https://vb-audio.com/Cable/" };

  return (
    <section aria-labelledby="remote-title" className="rise mt-5 clay rounded-[24px] bg-raised p-5" style={{ "--i": 5 } as React.CSSProperties}>
      <h2 id="remote-title" className="text-[17px] font-semibold tracking-[-0.01em]">
        From {alias}
      </h2>
      <p className="mt-1 text-sm text-muted">Works when {alias} shares it (TCuFlow there → This computer shares).</p>

      <div className="mt-5 flex flex-col gap-4">
        <Toggle on={sound} disabled={busy} onChange={toggle("set_listening", setSound)} label="Play its sound here" />
        <Toggle on={mic} disabled={busy} onChange={toggle("set_mic", setMic)} label="Use its microphone" hint={`In your call app, pick “${cable.device}” as the microphone`} />
        <Toggle on={mirror} disabled={busy} onChange={toggle("set_mirroring", setMirror)} label="Show its notifications here" />
      </div>
      <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-5">
        <button className={quietButton} disabled={busy} onClick={() => run(() => invoke("open_share", { fingerprint }))}>
          Open its shared folder
        </button>
        <button className={quietButton} onClick={() => setTerminal(true)}>
          Open a terminal
        </button>
      </div>
      {error && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-danger">
          <p>{error}</p>
          {error.includes(`needs ${cable.name}`) && (
            <button className={quietButton} onClick={() => invoke("open_url", { url: cable.url })}>
              Get {cable.name}
            </button>
          )}
        </div>
      )}
      {/* outside the panel: its entrance transform would trap a fixed sheet */}
      {terminal &&
        createPortal(
          <Suspense fallback={null}>
            <Terminal fingerprint={fingerprint} alias={alias} onClose={() => setTerminal(false)} />
          </Suspense>,
          document.body,
        )}
    </section>
  );
}
