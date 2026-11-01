// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
import { LaptopIcon, PhoneIcon } from "./icons";

/**
 * A device's avatar: a disc in the device's own hue (from its fingerprint) with what it is drawn inside.
 * The mood only adjusts it quietly:
 *   idle / happy  as is
 *   waiting       breathes (a pairing request is out)
 *   searching     rings radiate (listening on the network)
 *   sad           desaturated (declined / offline / failed)
 */
export type Mood = "idle" | "waiting" | "happy" | "sad" | "searching";

function hash(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function Face({
  seed,
  size = 40,
  mood = "idle",
  kind = "computer",
  label,
}: {
  seed: string;
  size?: number;
  mood?: Mood;
  /** kept for older call sites; avatars don't look anywhere */
  look?: "left" | "right";
  kind?: "computer" | "phone";
  /** accessible name; omit when a visible name sits next to the avatar */
  label?: string;
}) {
  const hue = hash(seed) % 360;
  const Glyph = kind === "phone" || seed === "phone" || seed === "sim-mobile" ? PhoneIcon : LaptopIcon;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="avatar relative inline-grid shrink-0 place-items-center rounded-full transition-[filter,opacity] duration-300"
      style={
        {
          "--h": hue,
          width: size,
          height: size,
          filter: mood === "sad" ? "saturate(0)" : undefined,
          opacity: mood === "sad" ? 0.7 : 1,
          animation: mood === "waiting" ? "listen 1.6s ease-in-out infinite" : undefined,
        } as React.CSSProperties
      }
    >
      {mood === "searching" &&
        [0, 1].map((i) => (
          <span
            key={i}
            className="absolute inset-0 rounded-full ring-2 ring-current"
            style={{ animation: `ripple 2.4s ${i * 1.2}s var(--ease-out-soft) infinite`, opacity: 0 }}
          />
        ))}
      <Glyph size={Math.round(size * 0.5)} />
    </span>
  );
}
