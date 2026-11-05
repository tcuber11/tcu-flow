/** TCuFlow's empty-state scene in the clay style: a computer and a phone on a wooden slab, with the cursor's
 *  path flowing between them. Drawn here, in SVG, so it follows the theme and stays sharp at any size. */
export function DeskScene({ className, searching = true }: { className?: string; searching?: boolean }) {
  return (
    <svg viewBox="0 0 320 220" className={className} role="img" aria-label="A computer and a phone on a desk, linked">
      <defs>
        <linearGradient id="ds-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f08a4b" />
          <stop offset="1" stopColor="#c95a24" />
        </linearGradient>
        <linearGradient id="ds-wood-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6a46d" />
          <stop offset="1" stopColor="#e7773a" />
        </linearGradient>
        <linearGradient id="ds-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9dcec" />
        </linearGradient>
        <linearGradient id="ds-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9cdfb" />
          <stop offset="1" stopColor="#8e95f6" />
        </linearGradient>
        <linearGradient id="ds-phone" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8b8dc" />
          <stop offset="1" stopColor="#e3709f" />
        </linearGradient>
        <linearGradient id="ds-cube" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5ebde" />
          <stop offset="1" stopColor="#4fb9a6" />
        </linearGradient>
        <radialGradient id="ds-shadow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="rgb(40 50 110 / 0.35)" />
          <stop offset="1" stopColor="rgb(40 50 110 / 0)" />
        </radialGradient>
      </defs>

      {/* shadow and the wooden slab */}
      <ellipse cx="160" cy="196" rx="140" ry="16" fill="url(#ds-shadow)" />
      <rect x="24" y="150" width="272" height="40" rx="20" fill="url(#ds-wood)" />
      <rect x="24" y="146" width="272" height="30" rx="15" fill="url(#ds-wood-top)" />
      <path d="M44 156c40 4 90 6 130 4M150 166c40 2 80 1 120-3" stroke="#fbc39a" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6" />

      {/* the computer */}
      <rect x="128" y="138" width="44" height="12" rx="6" fill="url(#ds-body)" />
      <rect x="143" y="116" width="14" height="26" rx="4" fill="#c6cae0" />
      <rect x="84" y="36" width="132" height="88" rx="16" fill="url(#ds-body)" />
      <rect x="92" y="44" width="116" height="70" rx="10" fill="url(#ds-screen)" />
      <rect x="92" y="44" width="116" height="22" rx="10" fill="#ffffff" opacity="0.18" />
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3, 4].map((c) => <rect key={`${r}-${c}`} x={102 + c * 20} y={52 + r * 15} width="12" height="9" rx="4.5" fill="#ffffff" opacity={0.28 + ((r + c) % 3) * 0.12} />),
      )}
      {/* the cursor on its screen */}
      <path d="M186 92l12 5-5 1.6-1.8 5z" fill="#1c1f33" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />

      {/* the phone, leaning on a mint cube */}
      <rect x="236" y="112" width="34" height="34" rx="10" fill="url(#ds-cube)" />
      <rect x="236" y="112" width="34" height="12" rx="6" fill="#ffffff" opacity="0.25" />
      <g transform="rotate(-8 252 96)">
        <rect x="232" y="58" width="36" height="66" rx="10" fill="url(#ds-phone)" />
        <rect x="236" y="64" width="28" height="52" rx="6" fill="#ffffff" opacity="0.9" />
        <rect x="241" y="72" width="18" height="18" rx="5" fill="#8e95f6" />
        <rect x="241" y="95" width="18" height="5" rx="2.5" fill="#c9cdfb" />
        <rect x="241" y="104" width="12" height="5" rx="2.5" fill="#c9cdfb" />
      </g>

      {/* a butter cube on the left */}
      <rect x="44" y="118" width="30" height="30" rx="9" fill="#f3d77a" />
      <rect x="44" y="118" width="30" height="10" rx="5" fill="#ffffff" opacity="0.3" />

      {/* the cursor's path between them */}
      <g fill="#5b63f0">
        {[0, 1, 2, 3].map((i) => (
          <circle key={i} cx={216 + i * 6} cy={78 - i * 2} r={2.6} style={searching ? { animation: `flow 1.6s ${i * 0.2}s ease-in-out infinite` } : undefined} />
        ))}
      </g>
    </svg>
  );
}
