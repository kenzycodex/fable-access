import type { ReactNode } from "react";
import type { RiskAction } from "@/lib/fable/types";

/** Page title + optional description + optional right-aligned actions. */
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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[24px] font-bold text-gray-900 dark:text-white tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-[13px] text-gray-500 dark:text-white/50">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </div>
  );
}

/** A card surface for the dashboard canvas. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-3xl border border-[#ECEAFB] bg-white dark:border-white/[0.05] dark:bg-[#050505] p-6 shadow-[0_2px_14px_rgba(80,60,180,0.05)] transition-all hover:border-[#DDD8F7] dark:hover:border-white/[0.08] ${className}`.trim()}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent dark:block hidden" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/** A panel that inverts against the light canvas.
 *
 * Reserved for the one region a view is actually about — the activity stream on
 * the overview. Its value is that it is rare: a second dark panel on the same
 * screen and neither reads as primary any more. */
export function FeaturePanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-3xl bg-[#151329] p-6 shadow-[0_8px_30px_rgba(21,19,41,0.18)] dark:bg-[#0a0a12] dark:border dark:border-white/[0.05] ${className}`.trim()}>
      <div className="pointer-events-none absolute -right-16 -top-16 size-52 rounded-full bg-[#7C3AED]/15 blur-3xl" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/** A 12-point sparkline: trend as context, not as a chart.
 *
 * Deliberately minimal. It sits inside a stat tile whose value is the actual
 * message, so it carries shape only — no axes, no grid, no labels, and no
 * tooltip, because there is nothing to read off it precisely. The most recent
 * point is marked in the accent so "where we are now" is locatable; everything
 * before it is de-emphasised.
 *
 * `aria-hidden` because the value and its sub-label above already state the
 * number in text. Announcing a dozen unlabelled coordinates would add noise,
 * not information. */
export function Sparkline({ points, accent = "#7C3AED", className = "" }: {
  points: number[];
  accent?: string;
  className?: string;
}) {
  if (points.length < 2) return null;

  const w = 96;
  const h = 26;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const xy = points.map((p, i) => [i * step, h - ((p - min) / span) * (h - 4) - 2] as const);
  const path = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = xy[xy.length - 1];

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`h-[26px] w-24 overflow-visible ${className}`.trim()}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} stroke={accent} strokeOpacity={0.35} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={3} fill={accent} />
    </svg>
  );
}

/** A KPI tile: big value, label, optional delta and accent, with glowing orbs. */
export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = "text-[#7C3AED]",
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  accent?: string;
  /** Optional 12-point history, oldest first. Shape only, not a readable chart. */
  trend?: number[];
}) {
  const bgMap: Record<string, string> = {
    "text-emerald-400": "bg-emerald-50 dark:bg-[#05100a] border-emerald-100 dark:border-emerald-500/10 hover:border-emerald-200 dark:hover:border-emerald-500/20",
    "text-amber-400": "bg-amber-50 dark:bg-[#100d05] border-amber-100 dark:border-amber-500/10 hover:border-amber-200 dark:hover:border-amber-500/20",
    "text-red-400": "bg-red-50 dark:bg-[#100508] border-red-100 dark:border-red-500/10 hover:border-red-200 dark:hover:border-red-500/20",
    "text-[#7C3AED]": "bg-[#7C3AED]/5 dark:bg-[#0a0510] border-[#7C3AED]/10 dark:border-[#7C3AED]/20 hover:border-[#7C3AED]/20 dark:hover:border-[#7C3AED]/40",
  };
  const bgClass = bgMap[accent] || "bg-gray-50 dark:bg-[#050505] border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10";

  // The mark colour matches the tile's accent, which is a *status* hue here
  // (blocked is critical, flagged is warning). Those are reserved for state and
  // are never reused to tell series apart.
  const strokeMap: Record<string, string> = {
    "text-emerald-400": "#10B981",
    "text-amber-400": "#F59E0B",
    "text-red-400": "#EF4444",
    "text-[#7C3AED]": "#7C3AED",
  };

  return (
    <div className={`rounded-3xl border ${bgClass} transition-all p-5 flex flex-col gap-2 relative overflow-hidden group`}>

      <div className="relative z-10 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">{label}</span>
        {icon && (
          <span className={`flex size-8 items-center justify-center rounded-xl border border-gray-200/50 dark:border-white/[0.05] bg-white/60 dark:bg-white/[0.02] shadow-sm backdrop-blur-md transition-transform duration-300 group-hover:scale-110 ${accent}`}>
            {icon}
          </span>
        )}
      </div>

      {/* Proportional figures, not tabular. tabular-nums gives every digit the
          width of a zero, which reads loose at display sizes; it belongs in
          columns that must align vertically, not on a standalone value. */}
      <div className="relative z-10 mt-1 flex items-end justify-between gap-3">
        <span className="text-[32px] font-bold leading-none tracking-tight text-gray-900 dark:text-white">{value}</span>
        {trend && trend.length > 1 && (
          <Sparkline points={trend} accent={strokeMap[accent] ?? "#7C3AED"} className="mb-0.5 shrink-0" />
        )}
      </div>

      {sub && <span className="relative z-10 text-[12px] font-medium text-gray-500 dark:text-white/40">{sub}</span>}
    </div>
  );
}

/** PASS / FLAG / BLOCK chip, consistent with the demo bank. */
export function RiskBadge({ action }: { action: RiskAction }) {
  const colors = {
    BLOCK: "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20",
    FLAG: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20",
    PASS: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20",
  };
  
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${colors[action]}`}>{action}</span>
  );
}
