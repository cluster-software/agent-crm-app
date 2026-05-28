import type { CSSProperties, ReactNode } from "react";

export type BadgeKind = "neutral" | "accent" | "success" | "warning" | "danger";

export function Badge({
  kind = "neutral",
  dot = false,
  children,
  style
}: {
  kind?: BadgeKind;
  dot?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const cls = kind === "neutral" ? "badge" : `badge badge--${kind}`;
  return (
    <span className={cls} style={style}>
      {dot && <span className="badge__dot" />}
      {children}
    </span>
  );
}

export type StatusState = "running" | "ok" | "queued" | "error" | "idle";

const statusDot: Record<StatusState, string> = {
  running: "var(--accent)",
  ok: "var(--success)",
  queued: "var(--warning)",
  error: "var(--danger)",
  idle: "var(--text-dim)"
};

export function StatusPill({ state, label }: { state: StatusState; label?: string }) {
  const color = statusDot[state];
  return (
    <span className="status-pill">
      <span
        className="status-pill__dot"
        style={{
          background: color,
          boxShadow: `0 0 0 2px color-mix(in oklch, ${color} 28%, transparent)`
        }}
      />
      {label ?? state}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented-control__button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <span className="segmented-control__icon">{option.icon}</span>}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function MonoLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="mono-label" style={style}>
      {children}
    </div>
  );
}

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function Avatar({
  name,
  size = 22,
  src
}: {
  name: string;
  size?: number;
  src?: string;
}) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const initials = parts.map((p) => p[0] ?? "").join("") || "?";
  const hue = hashHue(name || "?");
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(180deg, oklch(0.55 0.06 ${hue}), oklch(0.42 0.05 ${hue}))`,
        fontSize: Math.max(9, size * 0.42)
      }}
    >
      <span className="avatar__initials">{initials}</span>
      {src ? (
        <img
          className="avatar__image"
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
}

export function CompanyMark({
  name,
  size = 22
}: {
  name: string;
  size?: number;
}) {
  const letter = (name.trim()[0] || "?").toUpperCase();
  const hue = hashHue(name || "?");
  return (
    <span
      className="company-mark"
      style={{
        width: size,
        height: size,
        background: `oklch(0.30 0.04 ${hue})`,
        color: `oklch(0.85 0.06 ${hue})`,
        fontSize: Math.max(10, size * 0.5)
      }}
    >
      {letter}
    </span>
  );
}

type BrandIconProps = { size?: number; className?: string };

export function LinkedInIcon({ size = 14, className }: BrandIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5v-9h3v9zM6.5 8.25A1.75 1.75 0 1 1 8.3 6.5a1.78 1.78 0 0 1-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0 0 13 14.19V19h-3v-9h2.9v1.3a3.11 3.11 0 0 1 2.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
    </svg>
  );
}

export function XIcon({ size = 14, className }: BrandIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M18.244 2H21.5l-7.5 8.578L23 22h-7.137l-5.59-7.31L3.86 22H.602l8.022-9.176L0 2h7.273l5.067 6.696L18.244 2zm-2.502 18.222h1.99L7.345 3.667H5.21l10.532 16.555z" />
    </svg>
  );
}

export function GitHubIcon({ size = 14, className }: BrandIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export function FilterChip({
  k,
  op,
  v
}: {
  k: string;
  op: string;
  v: string;
}) {
  return (
    <span className="chip">
      <span className="chip__key">{k}</span>
      <span className="chip__op">{op}</span>
      <span className="chip__val">{v}</span>
    </span>
  );
}
