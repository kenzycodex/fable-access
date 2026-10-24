"use client";

import Link from "next/link";
import { ArrowRight, Bank, CheckCircle, Lightning, ShieldWarning, Sparkle, Warning } from "@phosphor-icons/react";
import { BarChart } from "@/components/dashboard/charts";
import { Card, CardHeader, PageHeader, Skeleton, StatCard, StatGrid } from "@/components/dashboard/primitives";
import { ago, compact, EventIcon, eventDetail, eventLabel, fullDate, SetupBar } from "@/components/operator/ui";
import { useOperatorMe, usePlatformOverview } from "@/lib/fable/operator";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The platform at a glance: activity, what needs a person, and what operators did. */
export default function OperatorOverviewPage() {
  const { data, error } = usePlatformOverview();
  const { data: me } = useOperatorMe();
  const first = me?.name?.split(" ")[0];

  if (error) return <Card><p className="text-[14px] text-red-500">{error.message}</p></Card>;

  return (
    <>
      <PageHeader title={first ? `${greeting()}, ${first}` : "Overview"} description="Every institution on Fable, at a glance." />

      <StatGrid>
        <StatCard label="Institutions" value={data ? String(data.institutions) : "-"}
          sub={data ? `${data.stages.live} live · ${data.stages.setting_up + data.stages.ready} setting up` : "Loading"}
          icon={<Bank size={17} weight="fill" />} featured />
        <StatCard label="Decisions, 30 days" value={data ? compact(data.decisions_30d) : "-"}
          sub={data ? `${compact(data.real_customers)} real customers protected` : "Loading"} icon={<Lightning size={17} weight="fill" />} tone="warning" />
        <StatCard label="Ask Fable today" value={data ? compact(data.assistant.today.questions) : "-"}
          sub={data ? `${data.assistant.today.model_answers} AI answers` : "Loading"} icon={<Sparkle size={17} weight="fill" />} />
        <StatCard label="Cross-bank attempts" value={data ? String(data.security.access_denied_7d) : "-"}
          sub={data ? `${data.security.access_denied_24h} in 24 hours · all refused` : "Loading"} icon={<ShieldWarning size={17} weight="fill" />}
          tone={data?.security.access_denied_24h ? "danger" : "success"} />
      </StatGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Decisions per day" subtitle="Last 14 days" />
          {data ? (
            <BarChart
              data={buildDays(data.decisions_by_day).map((d) => ({ label: d.label, values: [d.passed, d.flagged, d.blocked] }))}
              series={[
                { key: "pass", label: "Passed", color: "#10b981" },
                { key: "flag", label: "Flagged", color: "#f59e0b" },
                { key: "block", label: "Blocked", color: "#ef4444" },
              ]}
              height={230}
              empty="No decisions in the last 14 days"
            />
          ) : (
            <Skeleton className="h-[230px]" />
          )}
        </Card>

        <Card padded={false} className="flex flex-col">
          <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-5">
            <CardHeader title="Needs attention" />
            {!!data?.attention.length && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[12px] font-bold text-amber-700 dark:text-amber-300">{data.attention.length}</span>
            )}
          </div>
          {!data ? (
            <div className="px-5 pb-5"><Skeleton className="h-40" /></div>
          ) : data.attention.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <CheckCircle size={26} weight="fill" className="text-emerald-500" />
              <p className="text-[13px] font-semibold text-d-text">Nothing is waiting</p>
            </div>
          ) : (
            <ul className="flex-1 divide-y divide-d-border overflow-y-auto border-t border-d-border lg:max-h-[280px]">
              {data.attention.map((a) => (
                <li key={a.institution_id}>
                  <Link href={`/operator/institutions/${encodeURIComponent(a.institution_id)}`}
                    className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-d-surface-2">
                    <Warning size={16} weight="fill" className={`mt-0.5 shrink-0 ${a.reason === "Ready to go live" ? "text-brand" : "text-amber-500"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-d-text">{a.name}</span>
                      <span className="block text-[12px] text-d-muted">{a.reason}</span>
                      <SetupBar done={a.setup_done} total={a.setup_total} className="mt-1.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-5">
          <CardHeader title="Recent operator activity" />
          <Link href="/operator/audit" className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-brand hover:underline">
            Audit log <ArrowRight size={12} />
          </Link>
        </div>
        {!data ? (
          <div className="px-5 pb-5"><Skeleton className="h-32" /></div>
        ) : data.recent_events.length === 0 ? (
          <p className="border-t border-d-border px-5 py-6 text-center text-[13px] text-d-muted">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-d-border border-t border-d-border">
            {data.recent_events.slice(0, 5).map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                <EventIcon type={e.event_type} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-d-text">
                  <span className="font-medium">{eventLabel(e.event_type)}</span>
                  <span className="text-d-muted">
                    {" · "}{String(e.payload.operator ?? "Fable")}
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
    </>
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
