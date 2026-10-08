import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "@phosphor-icons/react";
import { Badge } from "@/components/app-kit";
import { Sparkline } from "@/components/dashboard/charts";
import type { RiskAction, TransactionStatus } from "@/lib/fable/types";

// The console shares its component kit with the demo bank. Only the palette
// differs (see `.console-shell` in globals.css), so these are re-exported rather
// than redrawn.
export {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  DetailRow,
  EmptyState,
  Eyebrow,
  Field,
  IconButton,
  Notice,
  Segmented,
  Skeleton,
  TextInput,
  Toggle,
  inputClass,
} from "@/components/app-kit";
export { BarList, Sparkline } from "@/components/dashboard/charts";

/** Page title, an optional line under it, and optional actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-d-text lg:text-[30px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-d-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

const TONE_BUBBLE = {
  brand: "bg-brand/12 text-brand",
  success: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/14 text-amber-600 dark:text-amber-400",
  danger: "bg-red-500/12 text-red-600 dark:text-red-400",
} as const;

const TREND_COLOR = {
  brand: "#7c3aed",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
} as const;

export interface Delta {
  /** Already formatted, e.g. "12%". */
  text: string;
  direction: "up" | "down";
  /** Whether this movement is good news. Fewer blocked transfers is "up" in good
   * terms even though the number fell, so direction and tone are separate. */
  tone: "good" | "bad" | "neutral";
}

/** A KPI tile: label, a figure, how it moved, and optionally its shape. */
export function StatCard({
  label,
  value,
  sub,
  icon,
  delta,
  trend,
  tone = "brand",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  delta?: Delta | null;
  /** History, oldest first. Shape only, not a readable chart. */
  trend?: number[];
  tone?: keyof typeof TREND_COLOR;
}) {
  const deltaStyle =
    delta?.tone === "good"
      ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
      : delta?.tone === "bad"
        ? "bg-red-500/12 text-red-600 dark:text-red-400"
        : "bg-d-surface-2 text-d-muted";

  return (
    <div className="demo-card flex flex-col gap-3 rounded-[20px] border border-d-border bg-d-surface p-5 text-d-text">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-d-muted">{label}</span>
        <span className={`flex size-9 items-center justify-center rounded-xl ${TONE_BUBBLE[tone]}`}>
          {icon ?? <span className="size-2.5 rounded-full bg-current" />}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3">
        <span className="text-[30px] font-bold leading-none tracking-tight">{value}</span>
        {trend && trend.length > 1 && <Sparkline points={trend} color={TREND_COLOR[tone]} className="mb-0.5 shrink-0" />}
      </div>

      {(delta || sub) && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {delta && (
            <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold ${deltaStyle}`}>
              {delta.direction === "up" ? <ArrowUpRight size={12} weight="bold" /> : <ArrowDownRight size={12} weight="bold" />}
              {delta.text}
            </span>
          )}
          {sub && <span className="text-d-muted">{sub}</span>}
        </div>
      )}
    </div>
  );
}

/** Shield's verdict on a transfer. */
export function RiskBadge({ action }: { action: RiskAction }) {
  const tone = action === "BLOCK" ? "danger" : action === "FLAG" ? "warning" : "success";
  const label = action === "BLOCK" ? "Blocked" : action === "FLAG" ? "Flagged" : "Passed";
  return <Badge tone={tone}>{label}</Badge>;
}

const OUTCOME: Record<TransactionStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "brand" }> = {
  completed: { label: "Sent", tone: "success" },
  released: { label: "Released", tone: "brand" },
  held: { label: "In containment", tone: "brand" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  flagged: { label: "Awaiting review", tone: "warning" },
  blocked: { label: "Stopped", tone: "danger" },
};

/** What happened to a transfer after the verdict. The verdict itself never
 * changes (that would rewrite the audit trail), so a customer who verified and
 * released a blocked transfer is told apart from fraud that was actually stopped. */
export function OutcomeBadge({ status }: { status: TransactionStatus | undefined }) {
  const o = status ? OUTCOME[status] : undefined;
  if (!o) return null;
  return <Badge tone={o.tone}>{o.label}</Badge>;
}

/** A segmented bar of passed, flagged and blocked. */
export function RiskBar({ pass, flag, block }: { pass: number; flag: number; block: number }) {
  const total = pass + flag + block || 1;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-d-surface-2">
      <div style={{ width: `${(pass / total) * 100}%`, backgroundColor: "#10b981" }} className="transition-all duration-500" />
      <div style={{ width: `${(flag / total) * 100}%`, backgroundColor: "#f59e0b" }} className="transition-all duration-500" />
      <div style={{ width: `${(block / total) * 100}%`, backgroundColor: "#ef4444" }} className="transition-all duration-500" />
    </div>
  );
}

/** Shared table styling, so every console table has the same rhythm. */
export const table = {
  wrap: "overflow-x-auto",
  base: "w-full min-w-[640px] text-left text-[13px]",
  head: "text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint",
  th: "px-5 py-3 font-semibold",
  row: "border-t border-d-border transition-colors hover:bg-d-surface-2",
  td: "px-5 py-3.5",
};
