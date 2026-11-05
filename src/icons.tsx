/** TCuFlow's icon set: 20-unit grid, 1.6 stroke, round caps, drawn in currentColor. */
type IconProps = { className?: string; size?: number };

function Icon({ size = 16, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  );
}

export const LaptopIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="4.5" width="12" height="8.5" rx="1.4" />
    <path d="M2 15.5h16" />
  </Icon>
);

export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="2.5" width="8" height="15" rx="2" />
    <path d="M9 14.8h2" />
  </Icon>
);

export const WavesIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" />
    <path d="M7.2 7.2a4 4 0 0 0 0 5.6M12.8 7.2a4 4 0 0 1 0 5.6M4.8 4.8a7.4 7.4 0 0 0 0 10.4M15.2 4.8a7.4 7.4 0 0 1 0 10.4" />
  </Icon>
);

export const PlusCircleIcon = (p: IconProps) => (
  <svg aria-hidden width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 20 20" className={p.className}>
    <circle cx="10" cy="10" r="8" fill="currentColor" />
    <path d="M10 6.5v7M6.5 10h7" stroke="var(--color-on-accent)" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1" />
  </Icon>
);

export const IncomingIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 6.5v6.5M7.2 10.4 10 13.2l2.8-2.8" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 6v4.2l2.6 1.6" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 10.5 8.2 14 15.5 6.5" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
  </Icon>
);

export const RetryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 3.8v3.4h-3.4" />
  </Icon>
);

export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="2.4" />
    <path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="3.2" />
    <path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.8 12.2A6.5 6.5 0 0 1 7.8 4.2a6.5 6.5 0 1 0 8 8Z" />
  </Icon>
);

export const DisplayIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.8" y="3.5" width="14.4" height="10" rx="1.6" />
    <path d="M7.5 16.5h5M10 13.5v3" />
  </Icon>
);

/** the touchpad: a pointer over a pad */
export const TouchpadIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="15" height="12" rx="2.4" />
    <path d="M8.2 7.2l4.6 2.1-2 .6-.7 2z" fill="currentColor" />
  </Icon>
);

export const SendIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M17 3 8.5 11.5M17 3l-5.2 14-3.3-5.5L3 8.2z" />
  </Icon>
);

export const KeyboardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2" y="5" width="16" height="10" rx="1.8" />
    <path d="M5 8h.01M8 8h.01M11 8h.01M14 8h.01M5.5 11.5h.01M14.5 11.5h.01M8 11.5h4" />
  </Icon>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.5 4 6.5 10l6 6" />
  </Icon>
);
