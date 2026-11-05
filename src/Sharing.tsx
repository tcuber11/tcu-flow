// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { quietButton, type Sharing as SharingPrefs } from "./Pairing";

/** On/off switch in the panel style (label + optional hint to its right). */
export function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="group flex items-start gap-3 text-left focus-visible:outline-none disabled:opacity-50">
      <span className={`clay-dip relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors duration-200 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent ${on ? "bg-accent" : "bg-sunken"}`}>
        <span className={`clay-key absolute top-0.5 h-6 w-6 rounded-full bg-white transition-[left] duration-200 ease-[var(--ease-out-expo)] ${on ? "left-[22px]" : "left-0.5"}`} />
      </span>
      <span>
        <span className="block text-sm font-medium text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-faint">{hint}</span>}
      </span>
    </button>
  );
}

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** What linked computers may do here (screen view; off until turned on) and where received files go. TCuFlow
 *  does not offer LOKA's folder, sound, mic, notification or terminal sharing (the backend refuses those too). */
export function Sharing({ initial, received, mac, onChange }: { initial: SharingPrefs; received: string; mac: boolean; onChange: () => void }) {
  const [s, setS] = useState(initial);
  // macOS Screen Recording as TCuFlow sees it now (null elsewhere); re-read on coming back from System Settings
  const [recording, setRecording] = useState<boolean | null>(null);
  useEffect(() => {
    if (!mac) return;
    const read = () => invoke<boolean | null>("screen_allowed").then(setRecording, () => {});
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [mac]);
  const allowScreen = () => invoke("allow_screen").catch(() => {});
  const change = (patch: Partial<SharingPrefs>) => {
    const next = { ...s, ...patch };
    setS(next);
    invoke("set_sharing", { sharing: next }).then(onChange);
  };
  const pick = async () => (await open({ directory: true })) as string | null;
  const kbd = "rounded-md bg-tint/10 px-1.5 py-0.5 font-sans text-xs text-fg";

  return (
    <section aria-labelledby="sharing-title" className="rise mt-5 clay rounded-[24px] bg-raised p-5" style={{ "--i": 6 } as React.CSSProperties}>
      <h2 id="sharing-title" className="text-[17px] font-semibold tracking-[-0.01em]">
        This computer shares
      </h2>
      <p className="mt-1 text-sm text-muted">Only with linked computers, over their encrypted link.</p>
      <div className="mt-5 flex flex-col gap-4">
        <Toggle
          on={s.clipboard}
          onChange={(clipboard) => change({ clipboard })}
          label="Its clipboard"
          hint="Text, pictures and copied files cross with the cursor, both ways. Off keeps this computer's clipboard home and ignores what arrives."
        />
        <Toggle
          on={s.screen}
          onChange={(screen) => {
            change({ screen });
            if (screen && recording === false) allowScreen();
          }}
          label="Its screen"
          hint={mac ? "Linked computers can view and control this screen in a window. Needs Screen Recording permission the first time." : "Linked computers can view and control this screen in a window."}
        />
        {s.screen && recording === false && (
          <div role="status" className="ml-[60px] -mt-1 rounded-[18px] bg-warning/12 px-3.5 py-3 text-xs leading-relaxed text-fg">
            <p>
              macOS isn't letting TCuFlow record this screen yet, so viewers would see nothing. Switch TCuFlow on under Screen &amp; System Audio Recording, then
              reopen TCuFlow. Already on there? Remove TCuFlow from that list with −, then open it again from here.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1">
              <button className={quietButton} onClick={allowScreen}>
                Open Screen Recording
              </button>
              <button className={quietButton} onClick={() => invoke("reopen")}>
                Reopen TCuFlow
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Toggle
            on={!!s.folder}
            label="A folder"
            hint={s.folder ? `${folderName(s.folder)} opens as a drive on linked computers` : "Opens as a drive on linked computers"}
            onChange={async (on) => {
              if (!on) return change({ folder: null });
              const folder = await pick();
              if (folder) change({ folder });
            }}
          />
          {s.folder && (
            <button
              className={quietButton}
              onClick={async () => {
                const folder = await pick();
                if (folder) change({ folder });
              }}
            >
              Change…
            </button>
          )}
        </div>
        <Toggle on={s.sound} onChange={(sound) => change({ sound })} label="Its sound" hint="Linked computers can play what this computer plays." />
        <Toggle on={s.mic} onChange={(mic) => change({ mic })} label="Its microphone" hint="Linked computers can use it as their mic." />
        <Toggle on={s.notifications} onChange={(notifications) => change({ notifications })} label="Its notifications" hint="Shown on linked computers that ask for them." />
        <Toggle
          on={s.terminal}
          onChange={(terminal) => change({ terminal })}
          label="A terminal"
          hint="Linked computers can run any command here, as you. Turn on only between your own computers."
        />
      </div>
      <p className="mt-6 text-[15px] font-semibold">Received files</p>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-sm">
        <p className="min-w-0 text-muted">
          Received files go to <span className="text-fg">{folderName(received)}</span>
        </p>
        <div className="flex gap-1">
          <button
            className={quietButton}
            onClick={async () => {
              const folder = await pick();
              if (folder) invoke("set_received", { folder }).then(onChange);
            }}
          >
            Change…
          </button>
          <button className={quietButton} onClick={() => invoke("set_received", { folder: null }).then(onChange)}>
            Downloads
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs text-faint">
        <kbd className={kbd}>{mac ? "⌃ ⌥ V" : "Ctrl Alt V"}</kbd> pastes the files that arrived last into the app in front.
      </p>
    </section>
  );
}
