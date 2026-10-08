"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Binoculars, Brain, Ghost, ShieldCheck } from "@phosphor-icons/react";
import { Badge, Card, Notice, PageHeader } from "@/components/dashboard/primitives";
import { formatNairaCompact } from "@/lib/fable/format";
import { useAgentsOverview } from "@/lib/fable/useBackend";

export default function AgentsPage() {
  const { data, error } = useAgentsOverview();
  const offline = !data && error;

  return (
    <>
      <PageHeader
        title="Agents"
        description="Every Fable agent as an operational unit: what it has learned, what it is deciding, and how well it is doing, live from the intelligence layer."
      />

      {offline && (
        <Notice tone="warning">
          The Fable API is not reachable, so agent telemetry is unavailable. Start the API and this screen will populate live.
        </Notice>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <AgentCard
          href="/dashboard/agents/copilot"
          icon={<Brain size={22} weight="fill" />}
          name="Fable Copilot"
          tagline="Learns each customer's genuine habits so safe transfers stay frictionless."
          live={Boolean(data)}
          stats={[
            { label: "Customers learned", value: fmt(data?.copilot.customers_learned) },
            { label: "Data points", value: fmt(data?.copilot.data_points) },
            { label: "Devices tracked", value: fmt(data?.copilot.devices_tracked) },
            { label: "Locations tracked", value: fmt(data?.copilot.locations_tracked) },
          ]}
        />

        <AgentCard
          href="/dashboard/agents/shield"
          icon={<ShieldCheck size={22} weight="fill" />}
          name="Fable Shield"
          tagline="Scores every transfer through 14 signal layers in real time."
          live={Boolean(data)}
          stats={[
            { label: "Scored", value: fmt(data?.shield.transactions_scored) },
            { label: "Blocked", value: fmt(data?.shield.blocked) },
            { label: "Flagged", value: fmt(data?.shield.flagged) },
            { label: "Avg risk", value: data ? data.shield.avg_risk_score.toFixed(3) : "-" },
          ]}
        />

        <AgentCard
          href="/dashboard/agents/ghost"
          icon={<Ghost size={22} weight="fill" />}
          name="Fable Ghost"
          tagline="Contains risky transfers in cooling windows so money can come back."
          live={Boolean(data)}
          stats={[
            { label: "Containers", value: fmt(data?.ghost.containers_created) },
            { label: "Cancelled", value: fmt(data?.ghost.cancelled) },
            { label: "Cancel rate", value: data ? `${Math.round(data.ghost.cancellation_rate * 100)}%` : "-" },
            { label: "Money saved", value: data ? formatNairaCompact(data.ghost.money_saved_ngn) : "-" },
          ]}
        />

        <Card className="border-dashed">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-d-surface-2 text-d-faint">
                <Binoculars size={22} weight="fill" />
              </span>
              <div>
                <h2 className="text-[16px] font-semibold text-d-text">Fable Watch</h2>
                <p className="text-[12px] text-d-muted">Continuous account monitoring</p>
              </div>
            </div>
            <Badge>Coming soon</Badge>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-d-muted">
            {data?.watch.description ?? "Continuous account monitoring between transactions."} Watch will observe login
            patterns, dormancy changes and beneficiary edits, the risk that builds up between transfers.
          </p>
        </Card>
      </div>
    </>
  );
}

function fmt(n: number | undefined): string {
  return n === undefined ? "-" : n.toLocaleString("en-NG");
}

function AgentCard({
  href,
  icon,
  name,
  tagline,
  live,
  stats,
}: {
  href: string;
  icon: ReactNode;
  name: string;
  tagline: string;
  live: boolean;
  stats: { label: string; value: string }[];
}) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-colors group-hover:border-brand/40">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">{icon}</span>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold text-d-text">{name}</h2>
              <p className="text-[12px] text-d-muted">{tagline}</p>
            </div>
          </div>
          <Badge tone={live ? "success" : "neutral"}>{live ? "Active" : "Loading"}</Badge>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl bg-d-surface-2 px-4 py-3.5">
              <p className="truncate text-[22px] font-bold leading-tight tabular-nums text-d-text">{s.value}</p>
              <p className="mt-0.5 truncate text-[12px] font-medium text-d-muted">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-1.5 text-[12px] font-semibold text-brand">
          Open deep-dive <ArrowRight size={14} weight="bold" />
        </div>
      </Card>
    </Link>
  );
}
