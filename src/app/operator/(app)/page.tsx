"use client";

import Link from "next/link";
import { ArrowRight, Bank, CheckCircle, Lightning, Pulse, ShieldWarning, Sparkle, UsersThree, Warning } from "@phosphor-icons/react";
import { BarChart } from "@/components/dashboard/charts";
import { Card, CardHeader, PageHeader, Skeleton, StatCard, StatGrid } from "@/components/dashboard/primitives";
import {
  ago,
  compact,
  EventIcon,
  eventDetail,
  eventLabel,
  fullDate,
  InstitutionMark,
  SetupBar,
  STAGE,
  StageBadge,
  stageOf,
  type Stage,
} from "@/components/operator/ui";
import { useOperatorMe, usePlatformOverview, type PlatformOverview } from "@/lib/fable/operator";

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
          sub={data ? `${compact(data.customers - data.real_customers)} test customers besides` : "Loading"}
          icon={<UsersThree size={17} weight="fill" />} tone="success" />
        <StatCard label="Decisions, 30 days" value={data ? compact(data.decisions_30d) : "-"}
          sub="Across every institution" icon={<Lightning size={17} weight="fill" />} tone="warning" />
        <StatCard label="Ask Fable today" value={data ? compact(data.assistant.today.questions) : "-"}
          sub={data ? `${data.assistant.today.model_answers} AI answers, ${compact(data.assistant.today.input_tokens + data.assistant.today.output_tokens)} tokens` : "Loading"}
          icon={<Sparkle size={17} weight="fill" />} />
      </StatGrid>

      {/* Row: activity and what needs a person. Both cards share the row's height. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2">
          <CardHeader title="Decisions per day" subtitle="Every institution, last 14 days" />
          <div className="flex-1">
            {data ? (
              <BarChart
                data={buildDays(data.decisions_by_day).map((d) => ({ label: d.label, values: [d.passed, d.flagged, d.blocked] }))}
                series={[
                  { key: "pass", label: "Passed", color: "#10b981" },
                  { key: "flag", label: "Flagged", color: "#f59e0b" },
                  { key: "block", label: "Blocked", color: "#ef4444" },
                ]}
                height={240}
                empty="No decisions in the last 14 days"
              />
            ) : (
              <Skeleton className="h-[240px]" />
            )}
          </div>
        </Card>
        <Attention data={data} />
      </div>

      {/* Row: the pipeline, and the people acting on it. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2">
          <div className="flex items-start justify-between gap-3">
            <CardHeader title="Where institutions are" subtitle="From created to live. Open a stage to see who is in it." />
            <Link href="/operator/institutions" className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-brand hover:underline">
              All <ArrowRight size={12} />
            </Link>
          </div>
          {data ? <Pipeline stages={data.stages} /> : <Skeleton className="h-24" />}
          <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-d-faint">Newest</p>
          {!data ? (
            <Skeleton className="h-28" />
          ) : data.newest.length === 0 ? (
            <p className="text-[13px] text-d-muted">No institutions yet.</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {data.newest.map((i) => (
                <li key={i.institution_id}>
                  <Link href={`/operator/institutions/${encodeURIComponent(i.institution_id)}`}
                    className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-d-surface-2">
                    <InstitutionMark name={i.name} stage={stageOf(i)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-d-text">{i.name}</span>
                      <span className="block text-[12px] text-d-muted" title={fullDate(i.created_at)}>Created {ago(i.created_at)}</span>
                    </span>
                    <span className="hidden sm:block"><StageBadge stage={stageOf(i)} /></span>
                    <SetupBar done={i.setup_done} total={i.setup_total} className="w-28 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Security data={data} />
          <Card padded={false} className="flex flex-1 flex-col">
            <div className="flex items-start justify-between gap-2 p-5 pb-3">
              <CardHeader title="Operator activity" />
              <Link href="/operator/audit" className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-brand hover:underline">
                Audit log <ArrowRight size={12} />
              </Link>
            </div>
            {!data ? (
              <div className="px-5 pb-5"><Skeleton className="h-40" /></div>
            ) : data.recent_events.length === 0 ? (
              <Centered icon={<Pulse size={20} />} title="Nothing yet" body="Operator actions appear here." />
            ) : (
              <ul className="divide-y divide-d-border border-t border-d-border">
                {data.recent_events.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                    <EventIcon type={e.event_type} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-d-text">{eventLabel(e.event_type)}</span>
                      <span className="block truncate text-[12px] text-d-muted">
                        {String(e.payload.operator ?? "Fable")}
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
      </div>
    </>
  );
}

function Attention({ data }: { data: PlatformOverview | undefined }) {
  return (
    <Card padded={false} className="flex flex-col">
      <div className="flex items-start justify-between gap-2 p-5 pb-3">
        <CardHeader title="Needs attention" subtitle="Institutions waiting on someone" />
        {!!data?.attention.length && (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[12px] font-bold text-amber-700 dark:text-amber-300">
            {data.attention.length}
          </span>
        )}
      </div>
      {!data ? (
        <div className="px-5 pb-5"><Skeleton className="h-40" /></div>
      ) : data.attention.length === 0 ? (
        <Centered icon={<CheckCircle size={22} weight="fill" className="text-emerald-500" />} title="Nothing is waiting"
          body="Every institution is moving on its own. Stalled setups, missing owners and banks ready to go live show up here." />
      ) : (
        <ul className="flex-1 divide-y divide-d-border overflow-y-auto border-t border-d-border lg:max-h-[300px]">
          {data.attention.map((a) => (
            <li key={a.institution_id}>
              <Link href={`/operator/institutions/${encodeURIComponent(a.institution_id)}`}
                className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-d-surface-2">
                <Warning size={16} weight="fill" className={`mt-0.5 shrink-0 ${a.reason === "Ready to go live" ? "text-brand" : "text-amber-500"}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-d-text">{a.name}</span>
                  </span>
                  <span className="block text-[12px] text-d-muted">{a.reason}</span>
                  <SetupBar done={a.setup_done} total={a.setup_total} className="mt-1.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Security({ data }: { data: PlatformOverview | undefined }) {
  const day = data?.security.access_denied_24h ?? 0;
  const week = data?.security.access_denied_7d ?? 0;
  return (
    <Link href="/operator/audit?scope=security"
      className={`flex items-center gap-4 rounded-2xl border p-5 transition-colors hover:border-brand/40 ${
        day ? "border-red-500/40 bg-red-500/[0.06]" : "border-d-border bg-d-surface"
      }`}>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${day ? "bg-red-500 text-white" : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"}`}>
        <ShieldWarning size={22} weight="fill" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-d-text">Cross-bank access attempts</span>
        <span className="block text-[12px] text-d-muted">
          {data ? `${day} in 24 hours, ${week} in 7 days. Each was refused and logged.` : "Loading"}
        </span>
      </span>
      <ArrowRight size={14} className="shrink-0 text-d-faint" />
    </Link>
  );
}

function Centered({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-d-surface-2 text-d-muted">{icon}</span>
      <p className="text-[14px] font-semibold text-d-text">{title}</p>
      <p className="max-w-[18rem] text-[12px] leading-relaxed text-d-muted">{body}</p>
    </div>
  );
}

/** The four stages as one proportional bar, with a tile per stage. */
function Pipeline({ stages }: { stages: Record<Stage, number> }) {
  const order: Stage[] = ["setting_up", "ready", "live", "suspended"];
  const total = order.reduce((a, s) => a + stages[s], 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-d-surface-2">
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
