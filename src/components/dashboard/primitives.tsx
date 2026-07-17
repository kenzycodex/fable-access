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

/** A card surface for the dark dashboard canvas with smart gradient effects. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-[#050505] p-6 shadow-sm transition-all hover:border-gray-300 dark:hover:border-white/[0.08] ${className}`.trim()}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent dark:block hidden" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/** A KPI tile: big value, label, optional delta and accent, with glowing orbs. */
export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = "text-[#7C3AED]",
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  accent?: string;
}) {
  const bgMap: Record<string, string> = {
    "text-emerald-400": "bg-emerald-50 dark:bg-[#05100a] border-emerald-100 dark:border-emerald-500/10 hover:border-emerald-200 dark:hover:border-emerald-500/20",
    "text-amber-400": "bg-amber-50 dark:bg-[#100d05] border-amber-100 dark:border-amber-500/10 hover:border-amber-200 dark:hover:border-amber-500/20",
    "text-red-400": "bg-red-50 dark:bg-[#100508] border-red-100 dark:border-red-500/10 hover:border-red-200 dark:hover:border-red-500/20",
    "text-[#7C3AED]": "bg-[#7C3AED]/5 dark:bg-[#0a0510] border-[#7C3AED]/10 dark:border-[#7C3AED]/20 hover:border-[#7C3AED]/20 dark:hover:border-[#7C3AED]/40",
  };
  const bgClass = bgMap[accent] || "bg-gray-50 dark:bg-[#050505] border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10";

  return (
    <div className={`rounded-2xl border ${bgClass} transition-all p-5 flex flex-col gap-2 relative overflow-hidden group`}>
      
      <div className="relative z-10 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">{label}</span>
        {icon && (
          <span className={`flex size-8 items-center justify-center rounded-lg border border-gray-200/50 dark:border-white/[0.05] bg-white/50 dark:bg-white/[0.02] shadow-sm backdrop-blur-md transition-transform duration-300 group-hover:scale-110 ${accent}`}>
            {icon}
          </span>
        )}
      </div>
      <div className="relative z-10 mt-1">
        <span className="text-[32px] font-bold leading-none tabular-nums tracking-tight text-gray-900 dark:text-white drop-shadow-sm">{value}</span>
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
