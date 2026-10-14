"use client";

import Link from "next/link";
import { ArrowRight, Bank, CheckCircle, Lightning, Pulse, Sparkle, UsersThree, Warning } from "@phosphor-icons/react";
import { BarChart } from "@/components/dashboard/charts";
import { Card, CardHeader, EmptyState, PageHeader, Skeleton, StatCard, StatGrid } from "@/components/dashboard/primitives";
import { ago, compact, EventIcon, eventDetail, eventLabel, fullDate, SetupBar, STAGE, type Stage } from "@/components/operator/ui";
import { useOperatorMe, usePlatformOverview } from "@/lib/fable/operator";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The platform at a glance: where every institution is, what needs a person, what happened. */
export default function OperatorOverviewPage() {
  const { data, error } = usePlatformOverview();
  const { data: me } = useOperatorMe();
  const first = me?.name?.split(" ")[0];

  if (error) {
    return <Card><p className="text-[14px] text-red-500">{error.message}</p></Card>;
  }

  const days = buildDays(data?.decisions_by_day ?? []);

  return (
    <>
      <PageHeader
        title={first ? `${greeting()}, ${first}` : "Overview"}
        description="Every institution on Fable, where each one is, and what needs you."
      />

      <StatGrid>
        <StatCard label="Institutions" value={data ? String(data.institutions) : "-"}
          sub={data ? `${data.stages.live} live, ${data.stages.setting_up + data.stages.ready} setting up` : "Loading"}
          icon={<Bank size={17} weight="fill" />} featured />
        <StatCard label="Real customers protected" value={data ? compact(data.real_customers) : "-"}
          sub={data ? `${compact(data.customers)} including test customers` : "Loading"} icon={<UsersThree size={17} weight="fill" />} tone="success" />
        <StatCard label="Decisions, 30 days" value={data ? compact(data.decisions_30d) : "-"}
          sub="Across every institution" icon={<Lightning size={17} weight="fill" />} tone="warning" />
        <StatCard label="Ask Fable today" value={data ? compact(data.assistant.today.questions) : "-"}
          sub={data ? `${data.assistant.today.model_answers} AI answers, ${compact(data.assistant.today.input_tokens + data.assistant.today.output_tokens)} tokens` : "Loading"}
          icon={<Sparkle size={17} weight="fill" />} />
      </StatGrid>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Where institutions are" subtitle="From created to live. Click a stage to see who is in it." />
          {data ? <Pipeline stages={data.stages} /> : <Skeleton className="h-28" />}
        </Card>
        <Card className="lg:col-span-2" padded={false}>
          <div className="p-5 pb-3">
            <CardHeader title="Needs attention" subtitle="Institutions waiting on someone." />
          </div>
          {!data ? (
            <div className="px-5 pb-5"><Skeleton className="h-28" /></div>
          ) : data.attention.length === 0 ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-[13px] text-d-muted">
              <CheckCircle size={16} weight="fill" className="text-emerald-500" /> Nothing is waiting.
            </p>
          ) : (
            <ul className="max-h-[260px] divide-y divide-d-border overflow-y-auto border-t border-d-border">
              {data.attention.map((a) => (
                <li key={a.institution_id}>
                  <Link href={`/operator/institutions/${encodeURIComponent(a.institution_id)}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-d-surface-2">
                    <Warning size={16} weight="fill" className={a.reason === "Ready to go live" ? "text-brand" : "text-amber-500"} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-d-text">{a.name}</span>
                        <span className="shrink-0 text-[12px] text-d-muted">{a.reason}</span>
                      </span>
                      <SetupBar done={a.setup_done} total={a.setup_total} className="mt-1.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Decisions per day" subtitle="Every institution, last 14 days" />
          {data ? (
            <BarChart
              data={days.map((d) => ({ label: d.label, values: [d.passed, d.flagged, d.blocked] }))}
              series={[
                { key: "pass", label: "Passed", color: "#10b981" },
                { key: "flag", label: "Flagged", color: "#f59e0b" },
                { key: "block", label: "Blocked", color: "#ef4444" },
              ]}
              empty="No decisions in the last 14 days"
            />
          ) : (
            <Skeleton className="h-[220px]" />
          )}
        </Card>
        <Card className="lg:col-span-2" padded={false}>
          <div className="flex items-start justify-between gap-2 p-5 pb-3">
            <CardHeader title="Recent operator activity" />
            <Link href="/operator/audit" className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-brand hover:underline">
              Audit log <ArrowRight size={12} />
            </Link>
          </div>
          {!data ? (
            <div className="px-5 pb-5"><Skeleton className="h-40" /></div>
          ) : data.recent_events.length === 0 ? (
            <EmptyState icon={<Pulse size={22} />} title="Nothing yet" body="Operator actions appear here." />
          ) : (
            <ul className="divide-y divide-d-border border-t border-d-border">
              {data.recent_events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                  <EventIcon type={e.event_type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-d-text">{eventLabel(e.event_type)}</span>
                    <span className="block truncate text-[12px] text-d-muted">
                      {String(e.payload.operator ?? "")}
                      {e.institution_id ? ` · ${e.institution_id}` : ""}
                      {eventDetail(e.payload) ? ` · ${eventDetail(e.payload)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] text-d-faint" title={fullDate(e.created_at)}>{ago(e.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

/** The four stages as one proportional bar, with a tile per stage. */
function Pipeline({ stages }: { stages: Record<Stage, number> }) {
  const order: Stage[] = ["setting_up", "ready", "live", "suspended"];
  const total = order.reduce((a, s) => a + stages[s], 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 overflow-hidden rounded-full bg-d-surface-2">
        {total > 0 &&
          order.map((s) =>
            stages[s] ? <span key={s} style={{ width: `${(stages[s] / total) * 100}%`, background: STAGE[s].color }} /> : null,
          )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {order.map((s) => (
          <Link key={s} href={`/operator/institutions?stage=${s}`}
            className="rounded-xl border border-d-border px-3.5 py-3 transition-colors hover:border-brand/40 hover:bg-d-surface-2">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-d-muted">
              <span className="size-2 rounded-full" style={{ background: STAGE[s].color }} />
              {STAGE[s].label}
            </span>
            <span className="mt-1 block text-[22px] font-bold tabular-nums text-d-text">{stages[s]}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** The last 14 days, with empty days filled in. */
function buildDays(rows: { day: string; n: number; blocked: number; flagged: number }[]) {
  const by = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const r = by.get(key);
    const blocked = r?.blocked ?? 0;
    const flagged = r?.flagged ?? 0;
    out.push({
      label: d.toLocaleDateString("en-NG", { day: "numeric", month: "short" }),
      blocked,
      flagged,
      passed: Math.max((r?.n ?? 0) - blocked - flagged, 0),
    });
  }
  return out;
}
