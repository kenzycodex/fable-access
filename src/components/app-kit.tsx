"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { CircleNotch } from "@phosphor-icons/react";

/**
 * The demo bank's component kit.
 *
 * Every screen composes these instead of hand-rolling gray utilities, so light
 * and dark stay in step and a change to the look is made once. Colours come from
 * the semantic tokens in globals.css (`bg-d-surface`, `text-d-muted`, ...) and
 * from `brand`, which is the institution's own colour.
 */

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Page wrapper: one max width and one gutter for every screen. */
export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("mx-auto w-full max-w-[1240px] px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pt-7", className)}>
      {children}
    </div>
  );
}

export function Card({
  children,
  className = "",
  padded = true,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cx(
        "demo-card rounded-[20px] border border-d-border bg-d-surface text-d-text",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-d-text">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-d-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** A small caption above a value, used inside cards. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint", className)}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white shadow-sm hover:brightness-110 active:brightness-95",
  secondary: "bg-d-surface-2 text-d-text hover:bg-d-border",
  ghost: "text-d-muted hover:bg-d-surface-2 hover:text-d-text",
  danger: "bg-red-500 text-white shadow-sm hover:bg-red-600",
  success: "bg-emerald-500/12 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 gap-1.5 rounded-xl px-3.5 text-[12px]",
  md: "h-11 gap-2 rounded-xl px-4 text-[13px]",
  lg: "h-12 gap-2 rounded-2xl px-5 text-[14px]",
};

const buttonBase =
  "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  full?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  full = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(buttonBase, VARIANTS[variant], SIZES[size], full && "w-full", className)}
      {...rest}
    >
      {loading ? <CircleNotch size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon,
  full = false,
  className = "",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  full?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cx(buttonBase, VARIANTS[variant], SIZES[size], full && "w-full", className)}>
      {icon}
      {children}
    </Link>
  );
}

/** Square icon-only button used in the header and for small toolbar actions. */
export function IconButton({
  label,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-muted transition-colors hover:text-d-text",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export const inputClass =
  "h-12 w-full rounded-xl border border-d-border bg-d-surface-2 px-4 text-[14px] text-d-text outline-none transition-shadow placeholder:text-d-faint focus:border-brand/50 focus:ring-4 focus:ring-brand/10 disabled:opacity-50";

export function Field({
  label,
  hint,
  error,
  right,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[12px] font-semibold text-d-muted">{label}</label>
        {right}
      </div>
      {children}
      {error ? (
        <p className="text-[12px] text-red-500">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-d-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputClass, className)} {...rest} />;
}

/** A row of mutually exclusive options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cx("inline-flex rounded-xl bg-d-surface-2 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-all",
              active ? "bg-d-surface text-d-text shadow-sm" : "text-d-muted hover:text-d-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        on ? "bg-brand" : "bg-d-border",
      )}
    >
      <span
        className={cx(
          "inline-block size-5 rounded-full bg-white shadow transition-transform",
          on ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Feedback and status
// ---------------------------------------------------------------------------

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

const TONES: Record<Tone, string> = {
  neutral: "bg-d-surface-2 text-d-muted",
  success: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/14 text-amber-600 dark:text-amber-400",
  danger: "bg-red-500/12 text-red-600 dark:text-red-400",
  brand: "bg-brand/12 text-brand",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** An inline message. Errors and notices share one shape so they read alike. */
export function Notice({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    neutral: "bg-d-surface-2 text-d-muted",
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    warning: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
    danger: "bg-red-500/10 text-red-600 dark:text-red-400",
  }[tone];
  return <div className={cx("rounded-xl px-4 py-3 text-[13px] leading-relaxed", styles, className)}>{children}</div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-d-surface-2", className)} />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-d-surface-2 text-d-muted">{icon}</span>
      <p className="mt-1 text-[14px] font-semibold text-d-text">{title}</p>
      {body && <p className="max-w-[300px] text-[13px] leading-relaxed text-d-muted">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People and data
// ---------------------------------------------------------------------------

const AVATAR_TINTS = [
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-teal-500/15 text-teal-600 dark:text-teal-300",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const tint = AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
  const dim = size === "lg" ? "size-12 text-[16px]" : size === "sm" ? "size-9 text-[12px]" : "size-10 text-[14px]";
  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-full font-bold", dim, tint)}>
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * A half-ring gauge: a value from 0 to 100 around a 180 degree arc.
 * Pure SVG so it renders the same everywhere and needs no chart library.
 */
export function Gauge({
  value,
  tone = "brand",
  label,
  sublabel,
}: {
  value: number;
  tone?: "brand" | "success" | "warning" | "danger";
  label: string;
  sublabel?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 80;
  const arc = Math.PI * r;
  const stroke = {
    brand: "var(--brand-primary, #7c3aed)",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
  }[tone];

  return (
    <div className="relative mx-auto w-full max-w-[240px]">
      <svg viewBox="0 0 200 112" className="w-full" aria-hidden="true">
        <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="var(--d-surface-2)" strokeWidth="18" strokeLinecap="round" />
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={stroke}
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={`${(arc * pct) / 100} ${arc}`}
          style={{ transition: "stroke-dasharray 0.7s ease" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="text-[26px] font-bold leading-none tabular-nums text-d-text">{label}</p>
        {sublabel && <p className="mt-1 text-[12px] font-semibold text-d-muted">{sublabel}</p>}
      </div>
    </div>
  );
}

/** One label and value, used in detail lists. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
      <span className="shrink-0 text-d-muted">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-d-text">{children}</span>
    </div>
  );
}

/** Ring sweeps, then the tick strokes itself in. Pure SVG, no dependency. */
export function SuccessTick({ size = 72 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="27" className="stroke-emerald-500/15" strokeWidth="4" />
      <circle cx="32" cy="32" r="27" className="animate-check-ring stroke-emerald-500" strokeWidth="4" strokeLinecap="round" />
      <path
        d="M21 33.5 L28.5 41 L43 25"
        className="animate-check-stroke stroke-emerald-500"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
