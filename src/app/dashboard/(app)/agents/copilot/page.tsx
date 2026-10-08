"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Brain, MagnifyingGlass } from "@phosphor-icons/react";
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatCard,
  inputClass,
} from "@/components/dashboard/primitives";
import { CustomerSecurity } from "@/components/dashboard/CustomerSecurity";
import { apiChannelLabel } from "@/lib/fable/api";
import { useFableStore } from "@/lib/fable/store";
import { useCustomerNames } from "@/lib/fable/useInstitution";
import { useAgentsOverview, useCopilotCustomers } from "@/lib/fable/useBackend";

export default function CopilotAgentPage() {
  const nameFor = useCustomerNames();
  const { data: overview } = useAgentsOverview();
  const { data, mutate } = useCopilotCustomers();
  const store = useFableStore();
  const institutionId = store?.session.institutionId ?? null;
  const [query, setQuery] = useState("");

  const customers = useMemo(() => {
    const all = data?.customers ?? [];
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter((c) => c.user_id.toLowerCase().includes(q) || nameFor(c.user_id).toLowerCase().includes(q));
  }, [data, query, nameFor]);

  return (
    <>
      <PageHeader
        title="Fable Copilot"
        description="The behavioral baseline engine. Everything below is what Copilot has learned from transaction history, per customer, from the live database."
        actions={
          <ButtonLink href="/dashboard/agents" variant="secondary" icon={<ArrowLeft size={14} weight="bold" />}>
            All agents
          </ButtonLink>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Customers learned" value={String(overview?.copilot.customers_learned ?? "-")} icon={<Brain size={17} weight="fill" />} />
        <StatCard label="Data points" value={(overview?.copilot.data_points ?? 0).toLocaleString("en-NG")} sub={`${overview?.copilot.live_data_points ?? 0} live`} />
        <StatCard label="Devices tracked" value={String(overview?.copilot.devices_tracked ?? "-")} tone="success" />
        <StatCard label="Locations tracked" value={String(overview?.copilot.locations_tracked ?? "-")} tone="warning" />
      </div>

      <Card>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <CardHeader title="Per-customer baselines" subtitle="What each customer normally does" />
          <div className="relative sm:w-64">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-d-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or id"
              aria-label="Search customer name or id"
              className={`${inputClass} !h-10 pl-10 text-[13px]`}
            />
          </div>
        </div>

        {customers.length === 0 ? (
          <EmptyState
            icon={<Brain size={22} />}
            title={data ? "No customers match" : "Waiting for the Fable API"}
            body={data ? "Try a different name or id." : "Baselines appear once the API responds."}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {customers.map((c) => (
              <div key={c.user_id} className="rounded-2xl bg-d-surface-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <Avatar name={nameFor(c.user_id)} />
                    <div>
                      <Link
                        href={`/dashboard/customers/${encodeURIComponent(c.user_id)}`}
                        className="text-[14px] font-semibold text-d-text hover:text-brand hover:underline"
                      >
                        {nameFor(c.user_id)}
                      </Link>
                      <p className="font-mono text-[11px] text-d-faint">{c.user_id}</p>
                      <p className="text-[12px] text-d-muted">
                        {c.transactions_analyzed.toLocaleString("en-NG")} transactions analyzed · {c.live_transactions} live
                      </p>
                    </div>
                  </div>
                  {c.has_baseline ? (
                    <Badge tone="success">Baseline built</Badge>
                  ) : (
                    <Badge tone="warning">Learning ({c.transactions_analyzed}/3 min)</Badge>
                  )}
                </div>

                {c.has_baseline && (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    <BaselineFact label="Typical range" value={c.typical_range ?? "-"} />
                    <BaselineFact label="Active hours" value={c.active_hours ?? "-"} />
                    <BaselineFact label="Trusted recipients" value={String(c.trusted_recipients ?? 0)} />
                    <BaselineFact label="Known devices" value={String(c.known_devices ?? 0)} />
                    <BaselineFact label="Preferred channel" value={c.preferred_channel ? apiChannelLabel(c.preferred_channel) : "-"} />
                    <BaselineFact
                      label="Known cities"
                      value={c.known_cities && c.known_cities.length > 0 ? c.known_cities.join(", ") : "None yet"}
                    />
                    <BaselineFact
                      label="Avg session"
                      value={c.avg_session_duration_s != null ? `${Math.round(c.avg_session_duration_s)}s` : "No data yet"}
                    />
                    <BaselineFact
                      label="Avg time-to-submit"
                      value={c.avg_time_to_submit_s != null ? `${c.avg_time_to_submit_s}s` : "No data yet"}
                    />
                  </div>
                )}

                <div className="mt-4 border-t border-d-border pt-4">
                  <CustomerSecurity customer={c} institutionId={institutionId} onChanged={() => void mutate()} />
                </div>

                <p className="mt-3 text-[12px] text-d-faint">
                  Last activity {formatWhen(c.last_activity)} · baseline refreshed {c.last_updated ? formatWhen(c.last_updated) : "-"}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function BaselineFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-d-surface px-3 py-2.5">
      <p className="text-[11px] font-medium text-d-muted">{label}</p>
      <p className="truncate text-[13px] font-semibold text-d-text">{value}</p>
    </div>
  );
}

function formatWhen(iso: string): string {
  // The API stores naive UTC timestamps; force UTC unless a zone is present.
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const t = Date.parse(/Z|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  if (Number.isNaN(t)) return iso;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
