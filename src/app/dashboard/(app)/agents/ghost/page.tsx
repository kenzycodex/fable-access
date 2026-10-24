"use client";

import { ArrowCounterClockwise, ArrowLeft, Coins, Ghost, Timer } from "@phosphor-icons/react";
import {
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatCard,
  StatGrid,
} from "@/components/dashboard/primitives";
import { formatNaira, formatNairaCompact } from "@/lib/fable/format";
import { useCustomerNames } from "@/lib/fable/useInstitution";
import { useGhostContainers } from "@/lib/fable/useBackend";

const STATUS_TONE: Record<string, "warning" | "success" | "neutral"> = {
  HELD: "warning",
  CANCELLED: "success",
  RELEASED: "neutral",
  EXPIRED: "success",
};

export default function GhostAgentPage() {
  const nameFor = useCustomerNames();
  const { data } = useGhostContainers();
  const stats = data?.stats;

  return (
    <>
      <PageHeader
        title="Fable Ghost"
        description="Holds risky transfers so the money can come back."
        actions={
          <ButtonLink href="/dashboard/agents" variant="secondary" icon={<ArrowLeft size={14} weight="bold" />}>
            All agents
          </ButtonLink>
        }
      />

      <StatGrid>
        <StatCard label="Containers created" value={String(stats?.created ?? "-")} sub="Transfers Ghost has held" icon={<Ghost size={17} weight="fill" />} featured />
        <StatCard label="Currently held" value={String(stats?.held ?? "-")} tone="warning" sub="Inside a cooling window" icon={<Timer size={17} weight="fill" />} />
        <StatCard label="Cancellation rate" value={stats ? `${Math.round(stats.cancellation_rate * 100)}%` : "-"} tone="success" sub="Money recovered" icon={<ArrowCounterClockwise size={17} weight="bold" />} />
        <StatCard label="Money saved" value={stats ? formatNairaCompact(stats.money_saved_ngn) : "-"} tone="success" sub="From cancelled holds" icon={<Coins size={17} weight="fill" />} />
      </StatGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Cooling windows" subtitle="The scarier the transfer, the longer the money stays recoverable." />
          <div className="flex flex-col gap-2">
            <WindowRow label="High risk (0.9 or more)" minutes={data?.cooling_windows.high_risk_minutes} dot="bg-red-500" />
            <WindowRow label="Medium risk (0.7 or more)" minutes={data?.cooling_windows.medium_risk_minutes} dot="bg-amber-500" />
            <WindowRow label="Lower risk" minutes={data?.cooling_windows.low_risk_minutes} dot="bg-emerald-500" />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Container history" subtitle="Every hold Ghost has placed" />
          {(data?.containers ?? []).length === 0 ? (
            <EmptyState
              icon={<Timer size={22} />}
              title={data ? "No containers yet" : "Waiting for the Fable API"}
              body={data ? "Trigger a risky transfer in the sandbox app to see one." : "Containers appear once the API responds."}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {(data?.containers ?? []).map((g) => (
                <div key={g.ghost_id} className="flex items-center justify-between gap-3 rounded-xl bg-d-surface-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-d-text">
                      {formatNaira(g.amount)} to{" "}
                      {g.recipient_id && g.recipient_id !== "unknown" ? g.recipient_id : g.recipient_account ? `•••• ${g.recipient_account.slice(-4)}` : "Unknown"}
                      {g.recipient_bank ? ` · ${g.recipient_bank}` : ""}
                    </p>
                    <p className="text-[12px] text-d-muted">
                      {nameFor(g.user_id)} · risk {g.risk_score?.toFixed(2) ?? "-"} · {g.cooling_window_minutes ?? "-"} min window
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[g.status] ?? "neutral"}>{g.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function WindowRow({ label, minutes, dot }: { label: string; minutes: number | undefined; dot: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-d-surface-2 px-3.5 py-3">
      <span className="flex items-center gap-2 text-[13px] font-medium text-d-muted">
        <span className={`size-2 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="text-[13px] font-bold tabular-nums text-d-text">{minutes ?? "-"} min</span>
    </div>
  );
}
