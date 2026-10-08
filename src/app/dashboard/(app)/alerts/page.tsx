"use client";

import { useMemo, useState } from "react";
import { BellRinging, Prohibit, ShieldCheck, Warning } from "@phosphor-icons/react";
import {
  Badge,
  Card,
  EmptyState,
  OutcomeBadge,
  PageHeader,
  RiskBadge,
  Segmented,
  Skeleton,
  StatCard,
} from "@/components/dashboard/primitives";
import { alerts } from "@/lib/fable/analytics";
import { formatNaira, formatRelativeTime, formatRiskScore } from "@/lib/fable/format";
import { CHANNEL_LABELS } from "@/lib/fable/scoring";
import type { Transaction } from "@/lib/fable/types";
import { useDashboardFeed } from "@/lib/fable/useBackend";

type Filter = "ALL" | "BLOCK" | "FLAG";

export default function AlertsPage() {
  // Live from the FastAPI feed so /demo transfers surface here in real time.
  const feed = useDashboardFeed();
  const [filter, setFilter] = useState<Filter>("ALL");

  const items = useMemo(() => alerts(feed.transactions), [feed.transactions]);
  const blocked = items.filter((t) => t.action === "BLOCK").length;
  const flagged = items.length - blocked;
  const shown = filter === "ALL" ? items : items.filter((t) => t.action === filter);

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Everything Shield flagged or blocked, with the signals behind each decision. New ones appear here as they happen."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Open alerts" value={feed.ready ? String(items.length) : "-"} sub="Flagged or blocked" icon={<BellRinging size={17} weight="fill" />} />
        <StatCard label="Blocked" value={feed.ready ? String(blocked) : "-"} sub="Stopped before money moved" icon={<Prohibit size={17} weight="bold" />} tone="danger" />
        <StatCard label="Flagged" value={feed.ready ? String(flagged) : "-"} sub="Sent for verification" icon={<Warning size={17} weight="fill" />} tone="warning" />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-d-border px-5 py-4">
          <p className="text-[15px] font-semibold text-d-text">
            {filter === "ALL" ? "All alerts" : filter === "BLOCK" ? "Blocked" : "Flagged"}
            <span className="ml-2 text-[13px] font-medium text-d-muted">{feed.ready ? shown.length : ""}</span>
          </p>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ALL", label: "All" },
              { value: "BLOCK", label: "Blocked" },
              { value: "FLAG", label: "Flagged" },
            ]}
          />
        </div>

        {!feed.ready ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={22} />} title="No alerts" body="Every transfer in this view passed cleanly." />
        ) : (
          <ul className="divide-y divide-d-border">
            {shown.map((t) => (
              <AlertRow key={t.id} txn={t} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function AlertRow({ txn }: { txn: Transaction }) {
  const isBlock = txn.action === "BLOCK";
  const color = txn.riskScore >= 0.8 ? "#ef4444" : "#f59e0b";

  return (
    <li className="flex gap-4 px-5 py-5">
      <span
        className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl ${
          isBlock ? "bg-red-500/12 text-red-600 dark:text-red-400" : "bg-amber-500/14 text-amber-600 dark:text-amber-400"
        }`}
      >
        {isBlock ? <Prohibit size={20} weight="bold" /> : <Warning size={20} weight="fill" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold text-d-text">
              {txn.customerName}
              <span className="text-[13px] font-normal text-d-faint">to</span>
              {txn.recipientName}
              {txn.live && <Badge tone="brand">Live</Badge>}
            </p>
            <p className="mt-1 text-[13px] text-d-muted">
              <span className="font-semibold tabular-nums text-d-text">{formatNaira(txn.amount)}</span> · {CHANNEL_LABELS[txn.channel]} ·{" "}
              {txn.recipientBank} · {formatRelativeTime(txn.timestamp)}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-14 overflow-hidden rounded-full bg-d-surface-2">
                <div className="h-full rounded-full" style={{ width: `${Math.round(txn.riskScore * 100)}%`, backgroundColor: color }} />
              </div>
              <span className="text-[14px] font-bold tabular-nums text-d-text">{formatRiskScore(txn.riskScore)}</span>
            </div>
            <RiskBadge action={txn.action} />
            <OutcomeBadge status={txn.status} />
          </div>
        </div>

        {txn.narration && <p className="mt-3 text-[13px] italic text-d-muted">&ldquo;{txn.narration}&rdquo;</p>}

        {txn.signals.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {txn.signals.map((s, i) => (
              <span
                key={s.code + i}
                className="inline-flex items-center gap-1.5 rounded-full bg-d-surface-2 px-2.5 py-1 text-[12px] font-medium text-d-muted"
              >
                <span className="size-1.5 rounded-full bg-amber-500" />
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
