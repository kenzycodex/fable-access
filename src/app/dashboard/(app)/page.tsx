"use client";

import Link from "next/link";
import { ArrowRight, ArrowSquareOut, Brain, Flag, Ghost, Lightning, ShieldCheck, Tray } from "@phosphor-icons/react";
import { BarChart, DonutChart } from "@/components/dashboard/charts";
import {
  Avatar,
  Badge,
  BarList,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  OutcomeBadge,
  PageHeader,
  RiskBadge,
  Skeleton,
  StatCard,
  table,
} from "@/components/dashboard/primitives";
import { changeLabel, dailyOutcomes, periodPair } from "@/lib/fable/analytics";
import { LATENCY_BUDGET_MS } from "@/lib/fable/constants";
import { formatNaira, formatNairaCompact, formatRelativeTime } from "@/lib/fable/format";
import type { Transaction } from "@/lib/fable/types";
import { useDashboardFeed, useDashboardStats, useIntelligence } from "@/lib/fable/useBackend";
import { useReviewCounts } from "@/lib/fable/useConsole";
import { useSignedInInstitution } from "@/lib/fable/useInstitution";

const AGENTS = [
  { name: "Copilot", role: "Learns each customer's habits", icon: Brain, href: "/dashboard/agents/copilot" },
  { name: "Shield", role: "Scores every transfer", icon: ShieldCheck, href: "/dashboard/agents/shield" },
  { name: "Ghost", role: "Holds risky transfers", icon: Ghost, href: "/dashboard/agents/ghost" },
];

const isProtected = (t: Transaction) =>
  t.action !== "PASS" && (t.status === "blocked" || t.status === "cancelled" || t.status === "held");

/** Daily counts over the last 12 days for the tile sparklines. Null when there is
 * not enough to draw, so a tile renders without a line rather than an invented one. */
function daySeries(txns: Transaction[], predicate: (t: Transaction) => boolean): number[] | null {
  if (txns.length === 0) return null;
  const DAY = 86_400_000;
  const today = Math.floor(Date.now() / DAY);
  const buckets = new Array(12).fill(0);
  let seen = 0;
  for (const t of txns) {
    if (!predicate(t)) continue;
    const age = today - Math.floor(t.timestamp / DAY);
    if (age >= 0 && age < 12) {
      buckets[11 - age] += 1;
      seen += 1;
    }
  }
  return seen > 1 ? buckets : null;
}

export default function OverviewPage() {
  const { institution } = useSignedInInstitution();
  const feed = useDashboardFeed();
  const { data: stats } = useDashboardStats();
  const { data: intel } = useIntelligence();

  const s = feed.stats;
  const txns = feed.transactions;
  const ready = feed.ready;
  const recent = txns.slice(0, 8);

  // Money kept out of fraud comes from the server's one definition, the same
  // number the Compliance page and Copilot quote. The client sum is only the
  // fallback while that loads or when the API is offline.
  const amountProtected = intel?.summary.fraud_prevented_ngn ?? s.amountProtected;

  // Decision time is the verdict time the 200ms budget governs: p50 is the
  // typical decision, and the caption checks the tail (p95) against the budget.
  const latency = stats?.latency_ms ?? null;
  const overBudget = latency !== null && latency.p95 > LATENCY_BUDGET_MS;

  // Week-on-week movement, from the same feed the numbers come from.
  const scored = periodPair(txns, (r) => r.length);
  const blocked = periodPair(txns, (r) => r.filter((t) => t.action === "BLOCK").length);
  const protectedPair = periodPair(txns, (r) => r.filter(isProtected).reduce((n, t) => n + t.amount, 0));

  const days = dailyOutcomes(txns, 14);
  const patterns = (intel?.scam_patterns ?? []).slice(0, 4).map((p) => ({ label: p.label, count: p.count }));

  const total = ready ? s.passCount + s.flagCount + s.blockCount : 0;
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");

  return (
    <>
      <PageHeader
        title={institution ? `Welcome back, ${institution.name}` : "Overview"}
        description="A live view of every decision Fable made across your customers."
        actions={
          <ButtonLink href="/demo" variant="secondary" size="md" icon={<ArrowSquareOut size={16} />}>
            Open the demo bank
          </ButtonLink>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Transactions scored"
          value={ready ? s.total.toLocaleString("en-NG") : "-"}
          sub="vs previous 7 days"
          delta={ready ? changeLabel(scored.current, scored.previous, true) : null}
          trend={ready ? (daySeries(txns, () => true) ?? undefined) : undefined}
          icon={<ShieldCheck size={17} weight="fill" />}
          featured
        />
        <StatCard
          label="Threats blocked"
          value={ready ? String(s.blockCount) : "-"}
          sub={ready ? `${s.flagCount} flagged for review` : "Loading"}
          delta={ready ? changeLabel(blocked.current, blocked.previous, false) : null}
          trend={ready ? (daySeries(txns, (t) => t.action === "BLOCK") ?? undefined) : undefined}
          tone="danger"
        />
        <StatCard
          label="Amount protected"
          value={ready ? formatNairaCompact(amountProtected) : "-"}
          sub="vs previous 7 days"
          delta={ready ? changeLabel(protectedPair.current, protectedPair.previous, true) : null}
          tone="success"
        />
        <StatCard
          label="Decision time"
          value={latency ? `${Math.round(latency.p50)}ms` : "-"}
          sub={
            !latency
              ? "No decisions measured yet"
              : `p95 ${Math.round(latency.p95)}ms, ${overBudget ? "over" : "within"} the ${LATENCY_BUDGET_MS}ms budget`
          }
          icon={<Lightning size={17} weight="fill" />}
          tone={overBudget ? "danger" : "warning"}
        />
      </div>

      {/* Trend and mix */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Decisions per day" subtitle="Last 14 days, by outcome" />
          {!ready ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <BarChart
              data={days.map((d) => ({ label: d.label, values: [d.pass, d.flag, d.block] }))}
              series={[
                { key: "pass", label: "Passed", color: "#10b981" },
                { key: "flag", label: "Flagged", color: "#f59e0b" },
                { key: "block", label: "Blocked", color: "#ef4444" },
              ]}
              empty="No decisions in the last 14 days"
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Risk distribution" subtitle="All decisions" />
          <DonutChart
            segments={[
              { label: "Passed", value: ready ? s.passCount : 0, color: "#10b981" },
              { label: "Flagged", value: ready ? s.flagCount : 0, color: "#f59e0b" },
              { label: "Blocked", value: ready ? s.blockCount : 0, color: "#ef4444" },
            ]}
            centerValue={ready ? total.toLocaleString("en-NG") : "-"}
            centerLabel="decisions"
          />
          <ul className="mt-5 flex flex-col gap-2.5 text-[13px]">
            {[
              { label: "Passed", n: s.passCount, color: "#10b981" },
              { label: "Flagged", n: s.flagCount, color: "#f59e0b" },
              { label: "Blocked", n: s.blockCount, color: "#ef4444" },
            ].map((row) => (
              <li key={row.label} className="flex items-center gap-2.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="text-d-muted">{row.label}</span>
                <span className="ml-auto font-semibold tabular-nums text-d-text">{ready ? row.n.toLocaleString("en-NG") : "-"}</span>
                <span className="w-10 text-right text-[12px] tabular-nums text-d-faint">{ready ? pct(row.n) : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Activity, agents, patterns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <div className="flex items-center justify-between px-5 pt-5">
            <CardHeader title="Live activity" subtitle="The latest decisions, newest first" />
            <Link href="/dashboard/transactions" className="-mt-3 text-[13px] font-semibold text-brand hover:underline">
              View all
            </Link>
          </div>

          {!ready ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState icon={<ShieldCheck size={22} />} title="No decisions yet" body="Transfers scored by Fable will appear here as they happen." />
          ) : (
            <div className={table.wrap}>
              <table className={table.base}>
                <thead>
                  <tr className={table.head}>
                    <th className={table.th}>Customer</th>
                    <th className={table.th}>Amount</th>
                    <th className={table.th}>Decision</th>
                    <th className={`${table.th} text-right`}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.id} className={table.row}>
                      <td className={table.td}>
                        <div className="flex items-center gap-3">
                          <Avatar name={t.customerName} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-d-text">
                              {t.customerName}
                              {t.live && <Badge tone="brand">Live</Badge>}
                            </p>
                            <p className="truncate text-[12px] text-d-muted">to {t.recipientName}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`${table.td} whitespace-nowrap font-semibold tabular-nums`}>{formatNaira(t.amount)}</td>
                      <td className={table.td}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <RiskBadge action={t.action} />
                          {t.action !== "PASS" && <OutcomeBadge status={t.status} />}
                        </div>
                      </td>
                      <td className={`${table.td} whitespace-nowrap text-right text-d-muted`}>{formatRelativeTime(t.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <NeedsReview />

          <Card>
            <CardHeader title="Agents" subtitle="All running" />
            <ul className="flex flex-col gap-1">
              {AGENTS.map((a) => {
                const Icon = a.icon;
                return (
                  <li key={a.name}>
                    <Link href={a.href} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-d-surface-2">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                        <Icon size={20} weight="fill" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold text-d-text">{a.name}</span>
                        <span className="block truncate text-[12px] text-d-muted">{a.role}</span>
                      </span>
                      <Badge tone="success">Active</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Top scam patterns"
              action={
                <Link href="/dashboard/intelligence" className="text-[13px] font-semibold text-brand hover:underline">
                  Insights
                </Link>
              }
            />
            <BarList items={patterns} emptyLabel="No scam patterns detected yet" color="#ef4444" />
          </Card>
        </div>
      </div>
    </>
  );
}

/** The work waiting on people, so the Overview leads somewhere actionable. */
function NeedsReview() {
  const { data } = useReviewCounts();
  const active = data?.active ?? 0;
  return (
    <Card>
      <CardHeader title="Needs review" subtitle="Flagged and blocked transfers awaiting a decision" />
      <div className="grid grid-cols-3 gap-2">
        <Mini label="Open" value={data?.open} icon={<Tray size={15} weight="fill" />} />
        <Mini label="In review" value={data?.in_review} />
        <Mini label="Escalated" value={data?.escalated} icon={<Flag size={15} weight="fill" />} danger />
      </div>
      <Link
        href="/dashboard/review"
        className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-[13px] font-semibold text-white transition-all hover:brightness-110"
      >
        {active ? `Work the queue (${active})` : "Open the review queue"} <ArrowRight size={15} weight="bold" />
      </Link>
    </Card>
  );
}

function Mini({ label, value, icon, danger = false }: { label: string; value?: number; icon?: React.ReactNode; danger?: boolean }) {
  return (
    <div className="rounded-xl bg-d-surface-2 px-3 py-2.5">
      <p className={`flex items-center gap-1 text-[11px] font-medium ${danger && value ? "text-red-600 dark:text-red-400" : "text-d-muted"}`}>
        {icon}
        {label}
      </p>
      <p className="text-[20px] font-bold tabular-nums text-d-text">{value ?? "-"}</p>
    </div>
  );
}
