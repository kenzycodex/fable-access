"use client";

import { AlertTriangleIcon, ShieldIcon } from "@/components/app-icons";
import { Card, PageHeader, RiskBadge } from "@/components/dashboard/primitives";
import { alerts } from "@/lib/fable/analytics";
import { formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { CHANNEL_LABELS } from "@/lib/fable/scoring";
import type { Transaction } from "@/lib/fable/types";
import { useDashboardFeed } from "@/lib/fable/useBackend";

export default function AlertsPage() {
  // Live from the FastAPI feed so /demo transfers surface here in real time.
  const feed = useDashboardFeed();
  const items = alerts(feed.transactions);
  const blocked = items.filter((t) => t.action === "BLOCK").length;

  return (
    <>
      <PageHeader
        title="Watch Alerts"
        description="Everything Shield flagged or blocked, with the signals behind each decision. Watch surfaces these as they happen."
      />

      <div className="flex flex-wrap gap-3 mt-2">
        <Pill icon={<ShieldIcon className="size-4 text-red-400" />} label={`${blocked} blocked`} />
        <Pill icon={<AlertTriangleIcon className="size-4 text-amber-400" />} label={`${items.length - blocked} flagged`} />
      </div>

      <div className="flex flex-col gap-4 mt-2">
        {!feed.ready ? (
          <Card>
            <div className="h-24 animate-pulse rounded bg-gray-100 dark:bg-white/[0.04]" />
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-[13px] text-gray-500 dark:text-white/40">No alerts. Every transfer passed cleanly.</p>
          </Card>
        ) : (
          items.map((t) => <AlertCard key={t.id} txn={t} />)
        )}
      </div>
    </>
  );
}

function Pill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white dark:border-white/[0.04] dark:bg-black px-4 py-2 text-[12px] font-bold text-gray-900 dark:text-white shadow-sm">
      {icon}
      {label}
    </span>
  );
}

function AlertCard({ txn }: { txn: Transaction }) {
  const isBlock = txn.action === "BLOCK";
  return (
    <Card className={`border-l-4 ${isBlock ? "border-l-red-500" : "border-l-amber-500"}`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-[16px] font-bold text-gray-900 dark:text-white tracking-tight">
              {txn.customerName} → {txn.recipientName}
              {txn.live && (
                <span className="rounded-md bg-[#7C3AED]/10 dark:bg-[#7C3AED]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#7C3AED]">
                  Live
                </span>
              )}
            </span>
            <span className="text-[12px] text-gray-500 dark:text-white/50 font-medium">
              {formatNaira(txn.amount)} · {CHANNEL_LABELS[txn.channel]} · {txn.recipientBank} ·{" "}
              {formatRelativeTime(txn.timestamp)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[20px] font-bold tabular-nums text-gray-900 dark:text-white tracking-tight">{txn.riskScore.toFixed(2)}</span>
            <RiskBadge action={txn.action} />
          </div>
        </div>

        {txn.narration && (
          <p className="rounded-lg bg-gray-50 dark:bg-white/[0.02] px-4 py-3 text-[13px] italic text-gray-600 dark:text-white/60 border border-gray-100 dark:border-white/[0.02]">
            &ldquo;{txn.narration}&rdquo;
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {txn.signals.map((s, i) => (
            <span
              key={s.code + i}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 dark:bg-white/[0.04] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-white/70 border border-gray-200 dark:border-white/[0.04]"
            >
              <span className="size-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
              {s.label}
            </span>
          ))}
        </div>

        <p className="text-[12px] text-gray-500 dark:text-white/50 font-medium mt-1 border-t border-gray-100 dark:border-white/[0.04] pt-4">
          Resolution: <span className="font-bold capitalize text-gray-900 dark:text-white">{txn.status}</span>
        </p>
      </div>
    </Card>
  );
}
