"use client";

import { useMemo, useState } from "react";
import { BellRinging, ShieldCheck } from "@phosphor-icons/react";
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
        <StatCard label="Blocked" value={feed.ready ? String(blocked) : "-"} sub="Stopped before money moved" tone="danger" />
        <StatCard label="Flagged" value={feed.ready ? String(flagged) : "-"} sub="Sent for verification" tone="warning" />
      </div>

      <div className="flex">
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

      <div className="flex flex-col gap-4">
        {!feed.ready ? (
          <Skeleton className="h-40 w-full" />
        ) : shown.length === 0 ? (
          <Card>
            <EmptyState icon={<ShieldCheck size={22} />} title="No alerts" body="Every transfer in this view passed cleanly." />
          </Card>
        ) : (
          shown.map((t) => <AlertCard key={t.id} txn={t} />)
        )}
      </div>
    </>
  );
}

function AlertCard({ txn }: { txn: Transaction }) {
  const isBlock = txn.action === "BLOCK";
  return (
    <Card className={`border-l-4 ${isBlock ? "!border-l-red-500" : "!border-l-amber-500"}`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[16px] font-semibold text-d-text">
              {txn.customerName}
              <span className="font-normal text-d-faint">to</span>
              {txn.recipientName}
              {txn.live && <Badge tone="brand">Live</Badge>}
            </p>
            <p className="mt-1 text-[12px] text-d-muted">
              {formatNaira(txn.amount)} · {CHANNEL_LABELS[txn.channel]} · {txn.recipientBank} · {formatRelativeTime(txn.timestamp)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[22px] font-bold tabular-nums text-d-text">{formatRiskScore(txn.riskScore)}</span>
            <RiskBadge action={txn.action} />
          </div>
        </div>

        {txn.narration && (
          <p className="rounded-xl bg-d-surface-2 px-4 py-3 text-[13px] italic text-d-muted">&ldquo;{txn.narration}&rdquo;</p>
        )}

        {txn.signals.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {txn.signals.map((s, i) => (
              <span
                key={s.code + i}
                className="inline-flex items-center gap-1.5 rounded-full bg-d-surface-2 px-3 py-1 text-[12px] font-medium text-d-muted"
              >
                <span className="size-1.5 rounded-full bg-amber-500" />
                {s.label}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-d-border pt-3 text-[12px] text-d-muted">
          Resolution <OutcomeBadge status={txn.status} />
        </div>
      </div>
    </Card>
  );
}
