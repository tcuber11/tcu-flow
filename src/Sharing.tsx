// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { quietButton, type Sharing as SharingPrefs } from "./Pairing";

/** On/off switch in the panel style (label + optional hint to its right). */
export function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="group flex items-start gap-3 text-left focus-visible:outline-none disabled:opacity-50">
      <span className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors duration-200 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent ${on ? "bg-accent" : "bg-tint/15"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-fg transition-[left] duration-200 ease-[var(--ease-out-expo)] ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span>
        <span className="block text-sm text-fg">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-faint">{hint}</span>}
      </span>
    </button>
  );
}

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Where received files go. TCuFlow does not offer LOKA's folder, sound, mic, notification or terminal
 *  sharing (out of MVP scope; the backend refuses those services too). */
export function Sharing({ received, mac, onChange }: { initial: SharingPrefs; received: string; mac: boolean; onChange: () => void }) {
  const pick = async () => (await open({ directory: true })) as string | null;
  const kbd = "rounded-md bg-tint/10 px-1.5 py-0.5 font-sans text-xs text-fg";

  return (
    <section aria-labelledby="sharing-title" className="rise mt-5 rounded-2xl border border-line bg-raised p-5" style={{ "--i": 6 } as React.CSSProperties}>
      <h2 id="sharing-title" className="text-[17px] font-semibold tracking-[-0.01em]">
        Received files
      </h2>
      <p className="mt-1 text-sm text-muted">Only from paired devices, over their encrypted link.</p>

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
