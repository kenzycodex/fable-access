"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { ArrowLeft, Brain, Prohibit, Receipt, Tray, Wallet, Warning } from "@phosphor-icons/react";
import { DonutChart } from "@/components/dashboard/charts";
import { CustomerSecurity } from "@/components/dashboard/CustomerSecurity";
import { STATE_LABEL, STATE_TONE } from "@/components/dashboard/CaseDetail";
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  OutcomeBadge,
  PageHeader,
  RiskBadge,
  Skeleton,
  StatCard,
  StatGrid,
  table,
} from "@/components/dashboard/primitives";
import { apiChannelLabel } from "@/lib/fable/api";
import { formatNaira, formatNairaCompact, formatRelativeTime, formatRiskScore } from "@/lib/fable/format";
import { useFableStore } from "@/lib/fable/store";
import { useCopilotCustomers } from "@/lib/fable/useBackend";
import { useTransactionRange } from "@/lib/fable/useConsole";
import { useCustomerNames } from "@/lib/fable/useInstitution";

export default function CustomerPage() {
  const params = useParams<{ userId: string }>();
  const userId = decodeURIComponent(params.userId);
  const nameFor = useCustomerNames();
  const store = useFableStore();
  const institutionId = store?.session.institutionId ?? null;

  const { data: customers, isLoading, mutate } = useCopilotCustomers();
  const customer = customers?.customers.find((c) => c.user_id === userId) ?? null;
  const { data: txnPage, isLoading: txnLoading } = useTransactionRange({ user: userId, limit: 200 });
  const txns = useMemo(() => txnPage?.transactions ?? [], [txnPage]);

  const pass = txns.filter((t) => t.action === "PASS").length;
  const flag = txns.filter((t) => t.action === "FLAG").length;
  const block = txns.filter((t) => t.action === "BLOCK").length;
  const cases = txns.filter((t) => t.review);
  const openCases = cases.filter((t) => t.review?.state !== "resolved").length;
  const confirmedFraud = cases.filter((t) => t.review?.outcome === "fraud").length;
  const name = nameFor(userId);

  if (!isLoading && customers && !customer && !txnLoading && txns.length === 0) {
    return (
      <>
        <BackLink />
        <Card>
          <EmptyState icon={<Brain size={22} />} title="Customer not found" body="They may belong to another institution, or have no activity yet." />
        </Card>
      </>
    );
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={name}
        description="Their baseline, transfers and cases."
        actions={
          openCases > 0 ? (
            <ButtonLink href="/dashboard/review" variant="secondary" icon={<Tray size={16} />}>
              {openCases} open {openCases === 1 ? "case" : "cases"}
            </ButtonLink>
          ) : undefined
        }
      />

      <StatGrid>
        <StatCard label="Transfers" value={txnPage ? txnPage.total.toLocaleString("en-NG") : "-"} sub={customer?.has_baseline ? "Baseline built" : "Still learning"} icon={<Receipt size={17} weight="fill" />} featured />
        <StatCard label="Balance" value={customer?.balance != null ? formatNairaCompact(customer.balance) : "-"} sub="Available now" tone="success" icon={<Wallet size={17} weight="fill" />} />
        <StatCard label="Flagged or blocked" value={txns.length ? String(flag + block) : "-"} sub={`${block} blocked`} tone="warning" icon={<Warning size={17} weight="fill" />} />
        <StatCard label="Confirmed fraud" value={String(confirmedFraud)} sub={`${cases.length} reviewed or open`} tone="danger" icon={<Prohibit size={17} weight="bold" />} />
      </StatGrid>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="What Copilot knows" subtitle="Their normal behaviour, learned from their own history" />
          {isLoading && !customer ? (
            <Skeleton className="h-32 w-full" />
          ) : customer ? (
            <>
              <div className="flex items-center gap-3">
                <Avatar name={name} size="lg" />
                <div>
                  <p className="text-[15px] font-semibold text-d-text">{name}</p>
                  <p className="text-[12px] text-d-muted">
                    {customer.transactions_analyzed.toLocaleString("en-NG")} transfers analysed · {customer.live_transactions} live
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Fact label="Typical range" value={customer.typical_range ?? "-"} />
                <Fact label="Active hours" value={customer.active_hours ?? "-"} />
                <Fact label="Trusted recipients" value={String(customer.trusted_recipients ?? 0)} />
                <Fact label="Known devices" value={String(customer.known_devices ?? 0)} />
                <Fact label="Preferred channel" value={customer.preferred_channel ? apiChannelLabel(customer.preferred_channel) : "-"} />
                <Fact label="Known cities" value={customer.known_cities?.length ? customer.known_cities.join(", ") : "None yet"} />
                <Fact label="Avg session" value={customer.avg_session_duration_s != null ? `${Math.round(customer.avg_session_duration_s)}s` : "-"} />
                <Fact label="Avg time to submit" value={customer.avg_time_to_submit_s != null ? `${customer.avg_time_to_submit_s}s` : "-"} />
              </div>
              <div className="mt-4 border-t border-d-border pt-4">
                <p className="mb-2 text-[12px] font-semibold text-d-muted">Verification</p>
                <CustomerSecurity customer={customer} institutionId={institutionId} onChanged={() => void mutate()} showBalance={false} />
              </div>
            </>
          ) : (
            <p className="text-[13px] text-d-muted">No baseline yet.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Decisions" subtitle="Everything Shield scored for them" />
          <DonutChart
            segments={[
              { label: "Passed", value: pass, color: "#10b981" },
              { label: "Flagged", value: flag, color: "#f59e0b" },
              { label: "Blocked", value: block, color: "#ef4444" },
            ]}
            centerValue={String(txns.length)}
            centerLabel="recent"
          />
        </Card>
      </div>

      <Card padded={false}>
        <div className="px-5 pt-5">
          <CardHeader title="Transfers" subtitle="Newest first" />
        </div>
        {txnLoading && !txnPage ? (
          <div className="space-y-3 p-5 pt-0">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : txns.length === 0 ? (
          <EmptyState icon={<Receipt size={22} />} title="No transfers yet" body="Their transfers will appear here." />
        ) : (
          <>
          <ul className="divide-y divide-d-border md:hidden">
            {txns.slice(0, 40).map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-d-text">{t.recipientName}</span>
                  <span className="mt-0.5 block text-[12px] text-d-muted">
                    {formatNaira(t.amount)} · {formatRelativeTime(t.timestamp)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <RiskBadge action={t.action} />
                  {t.review && (
                    <Link href={`/dashboard/review?case=${encodeURIComponent(t.id)}`} className="text-[11px] font-semibold text-brand">
                      {t.review.outcome ? (t.review.outcome === "fraud" ? "Fraud" : "Legitimate") : STATE_LABEL[t.review.state]}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className={`${table.wrap} hidden md:block`}>
            <table className={`${table.base} min-w-[760px]`}>
              <thead>
                <tr className={table.head}>
                  <th className={table.th}>Recipient</th>
                  <th className={table.th}>Amount</th>
                  <th className={table.th}>Risk</th>
                  <th className={table.th}>Decision</th>
                  <th className={table.th}>Review</th>
                  <th className={`${table.th} text-right`}>When</th>
                </tr>
              </thead>
              <tbody>
                {txns.slice(0, 60).map((t) => (
                  <tr key={t.id} className={table.row}>
                    <td className={table.td}>
                      <p className="font-medium text-d-text">{t.recipientName}</p>
                      <p className="text-[12px] text-d-muted">{t.recipientBank}</p>
                    </td>
                    <td className={`${table.td} whitespace-nowrap font-semibold tabular-nums`}>{formatNaira(t.amount)}</td>
                    <td className={`${table.td} tabular-nums`}>{formatRiskScore(t.riskScore)}</td>
                    <td className={table.td}>
                      <div className="flex flex-wrap gap-1.5">
                        <RiskBadge action={t.action} />
                        {t.action !== "PASS" && <OutcomeBadge status={t.status} />}
                      </div>
                    </td>
                    <td className={table.td}>
                      {t.review ? (
                        <Link href={`/dashboard/review?case=${encodeURIComponent(t.id)}`}>
                          <Badge tone={t.review.outcome === "fraud" ? "danger" : STATE_TONE[t.review.state]}>
                            {t.review.outcome ? (t.review.outcome === "fraud" ? "Fraud" : "Legitimate") : STATE_LABEL[t.review.state]}
                          </Badge>
                        </Link>
                      ) : (
                        <span className="text-d-faint">-</span>
                      )}
                    </td>
                    <td className={`${table.td} whitespace-nowrap text-right text-d-muted`}>{formatRelativeTime(t.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard/customers" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-d-muted hover:text-d-text">
      <ArrowLeft size={14} weight="bold" /> Customers
    </Link>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-d-surface-2 px-3 py-2.5">
      <p className="text-[11px] font-medium text-d-muted">{label}</p>
      <p className="truncate text-[13px] font-semibold text-d-text">{value}</p>
    </div>
  );
}
