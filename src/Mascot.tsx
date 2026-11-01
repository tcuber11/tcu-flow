import { useId } from "react";

/**
 * Flo, TCuFlow's mascot: a chubby drop with a pointer tip, the thing that flows between screens.
 * Coloured by a seed (a device fingerprint) or the accent; the face carries state:
 *   idle       blinks now and then, small smile
 *   searching  bobs while rings radiate from its tip (listening on the network)
 *   waiting    eyes glance side to side, "o" mouth (a request is out)
 *   happy      ^ ^ eyes, open smile (linked, done)
 *   sad        droopy eyes, flat mouth (declined, offline, failed)
 */
export type MascotMood = "idle" | "searching" | "waiting" | "happy" | "sad";

function hash(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// drop with its tip at the top-left, like a pointer; a short wave trails off the bottom-right
const BODY = "M18 14 C 46 16, 86 34, 86 62 C 86 80, 72 92, 54 92 C 36 92, 22 80, 20 62 C 18 44, 14 28, 18 14 Z";
const WAVE = "M60 93 C 68 99, 78 97, 86 90";

export function Mascot({ seed, size = 64, mood = "idle", label }: { seed?: string; size?: number; mood?: MascotMood; label?: string }) {
  const id = useId();
  const hue = seed ? hash(seed) % 360 : null;
  const body = hue == null ? "var(--color-accent)" : `oklch(0.72 0.17 ${hue})`;
  const shade = hue == null ? "color-mix(in oklab, var(--color-accent) 70%, black)" : `oklch(0.52 0.17 ${hue})`;
  const blinkDelay = `${((seed ? hash(seed) : 7) % 4000) / 1000}s`;
  const open = mood === "idle" || mood === "searching" || mood === "waiting";

  const eye = (x: number) =>
    mood === "happy" ? (
      <path key={x} d={`M${x - 5} 58 Q ${x} 51 ${x + 5} 58`} fill="none" stroke="#1d1d1f" strokeWidth="3" strokeLinecap="round" />
    ) : mood === "sad" ? (
      <path key={x} d={`M${x - 5} 55 Q ${x} 59 ${x + 5} 55`} fill="none" stroke="#1d1d1f" strokeWidth="3" strokeLinecap="round" />
    ) : (
      <g key={x} style={{ transformOrigin: `${x}px 56px`, animation: open && mood !== "waiting" ? `blink 5s ${blinkDelay} infinite` : undefined }}>
        <circle cx={x} cy={56} r={5.2} fill="#1d1d1f" />
        <circle cx={x + 1.8} cy={54} r={1.7} fill="#fff" />
      </g>
    );

  const mouth =
    mood === "happy" ? (
      <path d="M46 68 Q 54 78 62 68 Z" fill="#1d1d1f" />
    ) : mood === "sad" ? (
      <path d="M48 72 L 60 72" stroke="#1d1d1f" strokeWidth="3" strokeLinecap="round" />
    ) : mood === "waiting" ? (
      <circle cx="54" cy="71" r="3.5" fill="#1d1d1f" />
    ) : (
      <path d="M48 69 Q 54 74 60 69" fill="none" stroke="#1d1d1f" strokeWidth="3" strokeLinecap="round" />
    );

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="shrink-0 overflow-visible"
      style={{ filter: mood === "sad" ? "saturate(0.3)" : undefined, animation: mood === "searching" ? "bob 2.4s ease-in-out infinite" : undefined }}
    >
      {mood === "searching" &&
        [0, 1].map((i) => <circle key={i} cx="18" cy="14" r="14" fill="none" stroke={body} strokeWidth="2.5" style={{ transformOrigin: "18px 14px", animation: `ripple 2.4s ${i * 1.2}s var(--ease-out-soft) infinite`, opacity: 0 }} />)}
      <defs>
        <radialGradient id={`${id}-g`} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={WAVE} fill="none" stroke={shade} strokeWidth="4" strokeLinecap="round" opacity="0.8" />
      <path d={BODY} fill={body} />
      <path d={BODY} fill={`url(#${id}-g)`} />
      {/* cheeks */}
      <ellipse cx="38" cy="66" rx="4.5" ry="2.6" fill="#ff8aa0" opacity="0.55" />
      <ellipse cx="70" cy="66" rx="4.5" ry="2.6" fill="#ff8aa0" opacity="0.55" />
      <g style={{ animation: mood === "waiting" ? "glance 1.8s ease-in-out infinite" : undefined }}>
        {[46, 62].map(eye)}
      </g>
      {mouth}
    </svg>
  );
}
