"use client";

import Link from "next/link";
import { ArrowRight, Binoculars, Brain, Ghost, ShieldCheck } from "@phosphor-icons/react";
import { Card, PageHeader } from "@/components/dashboard/primitives";
import { formatNaira } from "@/lib/fable/format";
import { useAgentsOverview } from "@/lib/fable/useBackend";

export default function AgentsPage() {
  const { data, error } = useAgentsOverview();
  const offline = !data && error;

  return (
    <>
      <PageHeader
        title="Agents"
        description="Every Fable agent as an operational unit: what it has learned, what it's deciding, and how well it's doing — live from the intelligence layer."
      />

      {offline && (
        <Card>
          <p className="text-[13px] text-gray-500 dark:text-white/50">
            The Fable API isn&apos;t reachable, so agent telemetry is unavailable. Start the API
            (<span className="font-mono">uvicorn main:app</span> in <span className="font-mono">api/</span>) and this
            screen will populate live.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Copilot */}
        <AgentCard
          href="/dashboard/agents/copilot"
          icon={<Brain size={22} weight="fill" />}
          name="Fable Copilot"
          tagline="Learns each customer's genuine habits so safe transfers stay frictionless."
          status={data ? "active" : "…"}
          stats={[
            { label: "Customers learned", value: fmt(data?.copilot.customers_learned) },
            { label: "Data points", value: fmt(data?.copilot.data_points) },
            { label: "Devices tracked", value: fmt(data?.copilot.devices_tracked) },
            { label: "Locations tracked", value: fmt(data?.copilot.locations_tracked) },
          ]}
        />

        {/* Shield */}
        <AgentCard
          href="/dashboard/agents/shield"
          icon={<ShieldCheck size={22} weight="fill" />}
          name="Fable Shield"
          tagline="Scores every transfer through 12 signal layers in real time."
          status={data ? "active" : "…"}
          stats={[
            { label: "Scored", value: fmt(data?.shield.transactions_scored) },
            { label: "Blocked", value: fmt(data?.shield.blocked) },
            { label: "Flagged", value: fmt(data?.shield.flagged) },
            { label: "Avg risk", value: data ? data.shield.avg_risk_score.toFixed(3) : "—" },
          ]}
        />

        {/* Ghost */}
        <AgentCard
          href="/dashboard/agents/ghost"
          icon={<Ghost size={22} weight="fill" />}
          name="Fable Ghost"
          tagline="Contains risky transfers in cooling windows so money can come back."
          status={data ? "active" : "…"}
          stats={[
            { label: "Containers", value: fmt(data?.ghost.containers_created) },
            { label: "Cancelled", value: fmt(data?.ghost.cancelled) },
            {
              label: "Cancel rate",
              value: data ? `${Math.round(data.ghost.cancellation_rate * 100)}%` : "—",
            },
            { label: "Money saved", value: data ? formatNaira(data.ghost.money_saved_ngn) : "—" },
          ]}
        />

        {/* Watch — coming soon */}
        <Card className="opacity-70">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-gray-100 text-gray-400 dark:bg-white/[0.04] dark:text-white/30 border border-gray-200 dark:border-white/[0.05]">
                <Binoculars size={22} weight="fill" />
              </span>
              <div>
                <h2 className="text-[16px] font-bold text-gray-900 dark:text-white">Fable Watch</h2>
                <p className="text-[12px] text-gray-500 dark:text-white/40">Continuous account monitoring</p>
              </div>
            </div>
            <span className="rounded-full bg-gray-100 dark:bg-white/[0.05] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-white/30">
              Coming soon
            </span>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-gray-500 dark:text-white/50">
            {data?.watch.description ?? "Continuous account monitoring between transactions."} Watch will observe
            login patterns, dormancy changes, and beneficiary edits — the risk that builds up between transfers.
          </p>
        </Card>
      </div>
    </>
  );
}

function fmt(n: number | undefined): string {
  return n === undefined ? "—" : n.toLocaleString("en-NG");
}

function AgentCard({
  href,
  icon,
  name,
  tagline,
  status,
  stats,
}: {
  href: string;
  icon: React.ReactNode;
  name: string;
  tagline: string;
  status: string;
  stats: { label: string; value: string }[];
}) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-all group-hover:border-[#7C3AED]/30 dark:group-hover:border-[#7C3AED]/40">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20">
              {icon}
            </span>
            <div>
              <h2 className="text-[16px] font-bold text-gray-900 dark:text-white">{name}</h2>
              <p className="text-[12px] text-gray-500 dark:text-white/40">{tagline}</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {status}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl bg-gray-50 dark:bg-[#111] border border-gray-200 dark:border-white/[0.04] px-3 py-2.5">
              <p className="text-[16px] font-bold tabular-nums text-gray-900 dark:text-white truncate">{s.value}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/30">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-1.5 text-[12px] font-semibold text-[#7C3AED] opacity-0 transition-opacity group-hover:opacity-100">
          Open deep-dive <ArrowRight size={14} weight="bold" />
        </div>
      </Card>
    </Link>
  );
}
