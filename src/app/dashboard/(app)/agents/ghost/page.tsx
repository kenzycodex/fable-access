"use client";

import Link from "next/link";
import { ArrowLeft, Ghost, Timer } from "@phosphor-icons/react";
import { Card, PageHeader, StatCard } from "@/components/dashboard/primitives";
import { formatNaira } from "@/lib/fable/format";
import { useGhostContainers } from "@/lib/fable/useBackend";

const STATUS_STYLES: Record<string, string> = {
  HELD: "bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
  CANCELLED: "bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
  RELEASED: "bg-gray-100 text-gray-500 border-gray-200 dark:bg-white/[0.05] dark:text-white/40 dark:border-white/[0.08]",
};

export default function GhostAgentPage() {
  const { data } = useGhostContainers();
  const stats = data?.stats;

  return (
    <>
      <PageHeader
        title="Fable Ghost"
        description="The containment layer. When a user insists on a risky transfer, Ghost holds the money in a cooling window instead of letting it vanish — cancelled containers are fraud that never happened."
        actions={
          <Link href="/dashboard/agents" className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 hover:text-gray-900 dark:text-white/40 dark:hover:text-white">
            <ArrowLeft size={14} weight="bold" /> All agents
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Containers created" value={String(stats?.created ?? "—")} icon={<Ghost size={16} weight="fill" />} />
        <StatCard label="Currently held" value={String(stats?.held ?? "—")} accent="text-amber-400" />
        <StatCard label="Cancellation rate" value={stats ? `${Math.round(stats.cancellation_rate * 100)}%` : "—"} accent="text-emerald-400" sub="money recovered" />
        <StatCard label="Money saved" value={stats ? formatNaira(stats.money_saved_ngn) : "—"} accent="text-emerald-400" sub="from cancelled containers" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Timer size={16} className="text-[#7C3AED]" />
            <h2 className="text-[16px] font-bold text-gray-900 dark:text-white">Cooling windows</h2>
          </div>
          <p className="mb-4 text-[12px] leading-relaxed text-gray-500 dark:text-white/40">
            The window scales with risk: the scarier the transfer, the longer the money stays recoverable.
          </p>
          <div className="flex flex-col gap-2">
            <WindowRow label="High risk (≥ 0.9)" minutes={data?.cooling_windows.high_risk_minutes} accent="bg-red-500" />
            <WindowRow label="Medium risk (≥ 0.7)" minutes={data?.cooling_windows.medium_risk_minutes} accent="bg-amber-500" />
            <WindowRow label="Lower risk" minutes={data?.cooling_windows.low_risk_minutes} accent="bg-emerald-500" />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-[16px] font-bold text-gray-900 dark:text-white">Container history</h2>
          {(data?.containers ?? []).length === 0 ? (
            <p className="py-8 text-center text-[13px] text-gray-400 dark:text-white/30">
              {data ? "No containers yet — trigger a risky transfer in the demo bank." : "Waiting for the Fable API…"}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {(data?.containers ?? []).map((g) => (
                <div key={g.ghost_id} className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/[0.04] dark:bg-[#0d0d0d]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">
                        {formatNaira(g.amount)} → {g.recipient_id && g.recipient_id !== "unknown" ? g.recipient_id : g.recipient_account ? `•••• ${g.recipient_account.slice(-4)}` : "Unknown"}
                        {g.recipient_bank ? ` · ${g.recipient_bank}` : ""}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-white/35">
                        {g.user_id} · risk {g.risk_score?.toFixed(2) ?? "—"} · {g.cooling_window_minutes ?? "—"}min window
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[g.status] ?? STATUS_STYLES.RELEASED}`}>
                      {g.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function WindowRow({ label, minutes, accent }: { label: string; minutes: number | undefined; accent: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 dark:border-white/[0.04] dark:bg-[#0d0d0d]">
      <span className="flex items-center gap-2 text-[13px] font-medium text-gray-700 dark:text-white/70">
        <span className={`size-2 rounded-full ${accent}`} />
        {label}
      </span>
      <span className="text-[13px] font-bold tabular-nums text-gray-900 dark:text-white">{minutes ?? "—"} min</span>
    </div>
  );
}
