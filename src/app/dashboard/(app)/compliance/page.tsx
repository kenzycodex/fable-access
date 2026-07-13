"use client";

import { CheckIcon, FileCheckIcon } from "@/components/app-icons";
import { Card, PageHeader, RiskBadge, StatCard } from "@/components/dashboard/primitives";
import { summarize } from "@/lib/fable/analytics";
import { formatClock, formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { useDashboardFeed } from "@/lib/fable/useBackend";

// Regulatory frameworks Fable is built against (real Nigerian/industry
// standards). Presented as posture, nothing here is certified in the demo.
const FRAMEWORKS = [
  { name: "CBN Risk-Based Cybersecurity Framework", note: "Real-time transaction risk scoring" },
  { name: "NDPA 2023 + GAID 2025", note: "Data minimization, hashed signals only" },
  { name: "PCI-DSS", note: "Card fields stripped before any processing" },
  { name: "FATF AML typologies", note: "Mule-account and layering signals" },
];

export default function CompliancePage() {
  const feed = useDashboardFeed();
  const txns = [...feed.transactions].sort((a, b) => b.timestamp - a.timestamp);
  const s = summarize(txns);
  const auditTrail = txns.slice(0, 12);
  const incidents = txns.filter((t) => t.action === "BLOCK");

  return (
    <>
      <PageHeader
        title="Compliance"
        description="A full audit trail behind every Fable decision, ready for regulators and the board."
        actions={
          <button
            type="button"
            onClick={() => alert("In production this exports a signed PDF board report. Disabled in the demo.")}
            className="inline-flex items-center gap-2 rounded-full bg-[#7C3AED] px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-[#6D28D9] shadow-sm"
          >
            <FileCheckIcon className="size-4" />
            Export board report
          </button>
        }
      />

      {/* Board-report summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mt-2">
        <StatCard label="Decisions logged" value={String(s.total)} accent="text-[#7C3AED]" />
        <StatCard label="Amount protected" value={formatNaira(s.amountProtected)} accent="text-emerald-400" />
        <StatCard label="Incidents blocked" value={String(s.blockCount)} accent="text-red-400" />
        <StatCard label="Avg decision" value={`${s.avgLatencyMs}ms`} accent="text-amber-400" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 mt-4">
        {/* Audit trail */}
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Audit trail</h2>
          <div className="flex flex-col divide-y divide-gray-100 dark:divide-white/[0.04]">
            {!feed.ready ? (
              <div className="h-24 animate-pulse rounded bg-gray-100 dark:bg-white/[0.04]" />
            ) : (
              auditTrail.map((t) => (
                <div key={t.id} className="flex items-center gap-4 py-3 text-[13px]">
                  <span className="w-16 shrink-0 tabular-nums text-gray-500 dark:text-white/40">{formatClock(t.timestamp)}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-white/80 font-medium">
                    {t.customerName} → {t.recipientName} <span className="text-gray-400 dark:text-white/40 font-normal">· {formatNaira(t.amount)}</span>
                  </span>
                  <RiskBadge action={t.action} />
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Frameworks */}
        <Card>
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Regulatory posture</h2>
          <div className="flex flex-col gap-4">
            {FRAMEWORKS.map((f) => (
              <div key={f.name} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                  <CheckIcon className="size-3.5" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-bold text-gray-900 dark:text-white">{f.name}</span>
                  <span className="text-[12px] text-gray-500 dark:text-white/50">{f.note}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Incident log */}
      <Card>
        <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Incident log</h2>
        {feed.ready && incidents.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-gray-400 dark:text-white/40">No incidents on record.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100 dark:divide-white/[0.04]">
            {incidents.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-[13px]">
                <span className="font-bold text-gray-900 dark:text-white">{t.customerName}</span>
                <span className="text-gray-600 dark:text-white/60">
                  attempted {formatNaira(t.amount)} to {t.recipientName}
                </span>
                <span className="text-gray-400 dark:text-white/40">· {formatRelativeTime(t.timestamp)}</span>
                <span className="ml-auto text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-full border border-red-200 dark:border-red-500/20">{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
