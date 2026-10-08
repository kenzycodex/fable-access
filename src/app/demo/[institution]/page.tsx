"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  Eye,
  EyeSlash,
  PaperPlaneTilt,
  Plus,
  Receipt,
  ShieldCheck,
} from "@phosphor-icons/react";
import { BankCard } from "@/components/demo/BankCard";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { PageHeader } from "@/components/demo/PageHeader";
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  DetailRow,
  EmptyState,
  Eyebrow,
  Gauge,
  Screen,
  Skeleton,
} from "@/components/demo/kit";
import { summarizeCustomer } from "@/lib/fable/analytics";
import { customerOverview } from "@/lib/fable/api";
import {
  accountNumberFor,
  cardFor,
  formatNaira,
  formatRelativeTime,
} from "@/lib/fable/format";
import { ensureSession } from "@/lib/fable/session";
import { useFableStore } from "@/lib/fable/store";
import type { Transaction } from "@/lib/fable/types";
import { statusTone } from "@/lib/fable/ui";

export default function DemoHomePage() {
  const { href, customer, institutionId, name: bankName } = useInstitution();
  const router = useRouter();
  const store = useFableStore();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // Opening the banking app IS the login: the session clock starts here.
    ensureSession();
  }, []);

  // Balance, transactions and the learned baseline in one request. The balance
  // is the server's authoritative ledger figure, not client arithmetic.
  const { data: overview } = useSWR(
    customer ? ["demo:overview", customer.user_id, institutionId] : null,
    () => customerOverview(customer!.user_id, institutionId),
    { refreshInterval: 8_000, keepPreviousData: true },
  );
  const account = overview?.balance;
  const baseline = overview?.baseline;

  // Transfers made this session land in the local store first so they show at
  // once rather than on the next poll. Scoped to the selected customer: the
  // store is shared per institution, so without this one customer's transfers
  // would bleed into another's feed after a switch.
  const localLive = (store?.transactions ?? []).filter((t) => t.live && t.userId === customer?.user_id);
  const allTxns: Transaction[] = [
    ...localLive,
    ...(overview?.transactions ?? []).filter((t) => !localLive.some((l) => l.id === t.id)),
  ].sort((a, b) => b.timestamp - a.timestamp);
  const recent = allTxns.slice(0, 6);
  const summary = summarizeCustomer(allTxns, 0);

  const firstName = customer?.name.split(" ")[0] ?? "";
  const card = customer ? cardFor(customer.user_id) : null;
  const accountNumber = customer ? accountNumberFor(customer.user_id) : null;
  const loading = !overview && !!customer;

  // How much of this month's money in has gone out. Honest and derived: with no
  // income recorded there is nothing to compare against, so it shows as empty.
  const spendPct = summary.income > 0 ? Math.min(100, summary.spentPctOfIncome) : 0;
  const spendTone = spendPct >= 90 ? "danger" : spendPct >= 70 ? "warning" : "success";
  const spendLevel = summary.income === 0 ? "No income yet" : spendPct >= 90 ? "High" : spendPct >= 70 ? "Elevated" : "Normal";

  return (
    <Screen>
      <PageHeader
        title={`Welcome to ${bankName}`}
        subtitle={firstName ? `Hi, ${firstName}. Welcome back.` : "Welcome back."}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Card + account. On a phone it follows the balance and recent activity,
            which are what people open the app for; on desktop it leads. */}
        <Card className="order-3 lg:order-1 lg:col-span-7" padded>
          <CardHeader title="Debit card account" action={<Badge tone="success">Active</Badge>} />
          <div className="grid items-center gap-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            {card && customer ? (
              <BankCard holder={customer.name} number={card.number} expiry={card.expiry} />
            ) : (
              <Skeleton className="aspect-[1.586/1] w-full rounded-[22px]" />
            )}
            <div className="flex flex-col gap-1 rounded-2xl bg-d-surface-2 p-4">
              <Eyebrow>Account number</Eyebrow>
              <p className="font-mono text-[18px] font-semibold tracking-wider text-d-text">
                {accountNumber ?? "••••••••••"}
              </p>
              <div className="my-2 h-px bg-d-border" />
              <div className="flex items-center gap-2 text-[13px] font-semibold text-d-text">
                <ShieldCheck size={18} weight="fill" className="text-emerald-500" />
                Protected by Fable
              </div>
              <p className="text-[12px] leading-relaxed text-d-muted">
                Every transfer is checked against how {firstName || "you"} normally bank
                {firstName ? "s" : ""}.
              </p>
              <Link href={href("/transparency")} className="mt-1 text-[12px] font-semibold text-brand hover:underline">
                Manage security
              </Link>
            </div>
          </div>
        </Card>

        {/* Balance */}
        <Card className="order-1 lg:order-2 lg:col-span-5">
          <div className="flex items-center justify-between">
            <Eyebrow>Total balance</Eyebrow>
            <button
              type="button"
              onClick={() => setHidden((h) => !h)}
              className="flex size-8 items-center justify-center rounded-lg text-d-faint transition-colors hover:bg-d-surface-2 hover:text-d-text"
              aria-label={hidden ? "Show balance" : "Hide balance"}
            >
              {hidden ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="mt-3">
            {loading ? (
              <Skeleton className="h-11 w-48" />
            ) : (
              <p className="text-[38px] font-bold leading-none tracking-tight tabular-nums text-d-text">
                {hidden ? "••••••" : account ? formatNaira(account.available) : "—"}
              </p>
            )}
            {account && account.held > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/12 px-2.5 py-1 text-[12px] font-semibold text-amber-600 dark:text-amber-400">
                {formatNaira(account.held)} held in containment
              </p>
            )}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-2.5">
            <QuickAction href={href("/transfer")} icon={<PaperPlaneTilt size={20} weight="fill" />} label="Send" primary />
            <QuickAction href={href("/add-money")} icon={<Plus size={20} weight="bold" />} label="Add money" />
            <QuickAction href={href("/cards")} icon={<CreditCard size={20} weight="fill" />} label="Cards" />
          </div>
        </Card>

        {/* Recent transactions */}
        <Card className="order-2 lg:order-3 lg:col-span-7">
          <CardHeader
            title="Recent transactions"
            action={
              <Link href={href("/history")} className="text-[12px] font-semibold text-brand hover:underline">
                View all
              </Link>
            }
          />
          {store === null || loading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Receipt size={22} />}
              title="No transactions yet"
              body="Send or receive money and it will show up here."
              action={<ButtonLink href={href("/transfer")} size="sm">Send money</ButtonLink>}
            />
          ) : (
            <ul className="-mx-2 flex flex-col">
              {recent.map((t) => (
                <TxnRow key={t.id} txn={t} onOpen={() => router.push(href(`/tx/${t.id}`))} />
              ))}
            </ul>
          )}
        </Card>

        {/* Spend gauge */}
        <Card className="order-4 lg:order-4 lg:col-span-5">
          <CardHeader title="Spending this month" subtitle="Money out, as a share of money in" />
          <div className="pt-2">
            <Gauge value={spendPct} tone={spendTone} label={`${spendPct}%`} sublabel={spendLevel} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <FlowStat
              icon={<ArrowDownLeft size={16} weight="bold" />}
              tone="success"
              label="Money in"
              value={formatNaira(summary.income)}
            />
            <FlowStat
              icon={<ArrowUpRight size={16} weight="bold" />}
              tone="danger"
              label="Money out"
              value={formatNaira(summary.spent)}
            />
          </div>
        </Card>

        {/* Where it goes */}
        <Card className="order-5 lg:order-5 lg:col-span-7">
          <CardHeader title="Where your money goes" subtitle="Last 30 days" />
          {summary.categories.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-d-muted">No spending in the last 30 days.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {summary.categories.map((c) => (
                <div key={c.label}>
                  <div className="mb-1.5 flex items-center justify-between text-[13px]">
                    <span className="font-medium text-d-text">{c.label}</span>
                    <span className="font-semibold tabular-nums text-d-muted">{formatNaira(c.amount)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-d-surface-2">
                    <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* What Fable has learned */}
        <Card className="order-6 lg:order-6 lg:col-span-5">
          <CardHeader
            title="How you usually bank"
            subtitle="What Shield compares each transfer against"
            action={
              <Link href={href("/transparency")} className="text-[12px] font-semibold text-brand hover:underline">
                Details
              </Link>
            }
          />
          {baseline ? (
            <div className="divide-y divide-d-border">
              <DetailRow label="Typical transfer">{baseline.typical_transfer_range}</DetailRow>
              <DetailRow label="Active hours">{baseline.active_hours}</DetailRow>
              <DetailRow label="Trusted recipients">{baseline.trusted_recipients_count}</DetailRow>
              <DetailRow label="Transactions learned">{baseline.transactions_analyzed}</DetailRow>
            </div>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          )}
        </Card>
      </div>
    </Screen>
  );
}

function QuickAction({
  href,
  icon,
  label,
  primary = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-center gap-2 rounded-2xl border border-d-border bg-d-surface-2/60 px-2 py-3.5 transition-all hover:-translate-y-0.5 hover:bg-d-surface-2"
    >
      <span
        className={`flex size-10 items-center justify-center rounded-xl ${
          primary ? "bg-brand text-white shadow-sm" : "bg-d-surface text-d-text"
        }`}
      >
        {icon}
      </span>
      <span className="text-[12px] font-semibold text-d-text">{label}</span>
    </Link>
  );
}

function FlowStat({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  tone: "success" | "danger";
  label: string;
  value: string;
}) {
  const color = tone === "success" ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-red-500/12 text-red-600 dark:text-red-400";
  return (
    <div className="rounded-2xl bg-d-surface-2 p-3.5">
      <div className="flex items-center gap-2">
        <span className={`flex size-6 items-center justify-center rounded-lg ${color}`}>{icon}</span>
        <span className="text-[12px] font-medium text-d-muted">{label}</span>
      </div>
      <p className="mt-2 text-[16px] font-bold tabular-nums text-d-text">{value}</p>
    </div>
  );
}

function TxnRow({ txn, onOpen }: { txn: Transaction; onOpen: () => void }) {
  const credit = txn.direction === "credit";
  const flagged = txn.action !== "PASS";
  const tone = statusTone(txn.status);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-d-surface-2"
      >
        <Avatar name={txn.recipientName} />
        {/* min-w-0 lets the name truncate; the amount must never shrink, or a
            long resolved account name splits it across two lines. */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-d-text">{txn.recipientName}</p>
          <p className="flex items-center gap-2 text-[12px] text-d-muted">
            {formatRelativeTime(txn.timestamp)}
            {flagged && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${tone.chip}`}>{tone.label}</span>}
          </p>
        </div>
        <span
          className={`shrink-0 whitespace-nowrap text-[14px] font-bold tabular-nums ${
            credit ? "text-emerald-600 dark:text-emerald-400" : "text-d-text"
          }`}
        >
          {credit ? "+" : "-"}
          {formatNaira(txn.amount)}
        </span>
      </button>
    </li>
  );
}
