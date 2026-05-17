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
  size = 22
}: {
  name: string;
  size?: number;
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
      {initials}
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
