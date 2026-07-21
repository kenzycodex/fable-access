"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CreditCard,
  Eye,
  EyeSlash,
  PaperPlaneTilt,
  ClockCounterClockwise,
  DotsThreeOutline,
  Moon,
  Sun,
  X,
  ShieldCheck
} from "@phosphor-icons/react";
import { Avatar, Card, Screen } from "@/components/demo/kit";
import useSWR from "swr";
import { accountBalance, customerTransactions } from "@/lib/fable/api";
import { useCopilotBaseline } from "@/lib/fable/useBackend";
import { summarizeCustomer } from "@/lib/fable/analytics";
import { formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { DEMO_USER } from "@/lib/fable/seed";
import { ensureSession } from "@/lib/fable/session";
import { useFableStore } from "@/lib/fable/store";
import type { Transaction } from "@/lib/fable/types";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { CustomerSwitcher } from "@/components/demo/CustomerSwitcher";
import { PowerConnect } from "@/components/demo/PowerConnect";

export default function DemoHomePage() {
  const { href, customer, institutionId } = useInstitution();
  const router = useRouter();
  const store = useFableStore();
  const [balanceHidden, setBalanceHidden] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The active customer drives the feed; fall back to the seed user on the
  // first paint before the roster has loaded. (The avatar and name in the
  // header are rendered by CustomerSwitcher, which owns the same value.)
  // No fallback to a hardcoded person: before the roster resolves, every
  // institution briefly rendered the same "Ada Obi", which read as the tenants
  // sharing customers. Show the bank until its own customer is known.
  const displayName = customer?.name ?? "";

  useEffect(() => {
    setMounted(true);
    // Opening the banking app IS the login — the session clock starts here.
    ensureSession();
  }, []);

  // This customer's real history, from the server. The local store keys on
  // customer name, which collided the moment two institutions had a
  // similarly-named customer; user_id is unique per tenant.
  const { data: serverTxns } = useSWR(
    customer ? ["demo:txns", customer.user_id, institutionId] : null,
    () => customerTransactions(customer!.user_id, institutionId),
    { refreshInterval: 5_000, keepPreviousData: true },
  );

  // Live transfers made this session land in the local store first, so they
  // show immediately rather than waiting on the next poll. Scoped to the
  // selected customer — the store is shared per-institution, so without this
  // one customer's session transfers would bleed into another's after a switch.
  const localLive = (store?.transactions ?? []).filter((t) => t.live && t.userId === customer?.user_id);
  const allMyTxns: Transaction[] = [
    ...localLive,
    ...(serverTxns ?? []).filter((t) => !localLive.some((l) => l.id === t.id)),
  ].sort((a, b) => b.timestamp - a.timestamp);
  const myTxns = allMyTxns.slice(0, 5);

  // The balance comes from the server's ledger, not from arithmetic on the
  // client. It is the same number the transfer path checks against, so what
  // the customer sees and what the system enforces cannot drift apart.
  const { data: account } = useSWR(
    customer ? ["balance", customer.user_id, institutionId] : null,
    () => accountBalance(customer!.user_id, institutionId),
    { refreshInterval: 15_000, keepPreviousData: true },
  );

  // Income, spend and categories remain derived from the feed; only the
  // balance is authoritative elsewhere.
  const summary = summarizeCustomer(allMyTxns, 0);

  // What Copilot has actually learned about this customer — the same baseline
  // Shield scores against, so the profile card reflects live knowledge rather
  // than a fixed archetype label.
  const { data: baseline } = useCopilotBaseline(customer?.user_id);

  return (
    <Screen>
      {/* Top bar — account switching on the avatar, connection state on the
          power button, so neither needs a block of its own above the page. */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <CustomerSwitcher />
        <div className="flex shrink-0 items-center gap-2">
          <PowerConnect />
          {mounted && (
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="relative flex size-10 items-center justify-center rounded-xl bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-white/[0.04] dark:text-white/50 dark:hover:bg-white/[0.08]"
              aria-label="Toggle Theme"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          )}
          <Link
            href={href("/notifications")}
            className="relative flex size-10 items-center justify-center rounded-xl bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300 dark:bg-white/[0.04] dark:text-white/50 dark:hover:bg-white/[0.08] cursor-pointer"
            aria-label="Notifications"
          >
            <Bell size={18} />
            <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-red-500" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Bank card */}
          {/* The bank's own colour, not Fable's. color-mix darkens the primary
              for the gradient's far end so one setting drives the whole card. */}
          <div
            className="relative overflow-hidden rounded-2xl p-5 text-white shadow-xl"
            style={{
              background:
                "linear-gradient(135deg, var(--brand-primary, #7C3AED), color-mix(in srgb, var(--brand-primary, #7C3AED) 65%, black))",
            }}
          >
            <div className="pointer-events-none absolute -right-6 -top-6 size-28 rounded-full bg-white/[0.07]" />
            <div className="pointer-events-none absolute -bottom-8 -left-4 size-20 rounded-full bg-white/[0.05]" />
            <svg className="pointer-events-none absolute right-5 top-5 opacity-[0.15]" width="36" height="28" viewBox="0 0 36 28" fill="none">
              <rect width="36" height="28" rx="4" fill="currentColor"/>
              <line x1="0" y1="10" x2="36" y2="10" stroke="#111" strokeWidth="1.5" opacity="0.3"/>
              <line x1="0" y1="18" x2="36" y2="18" stroke="#111" strokeWidth="1.5" opacity="0.3"/>
              <line x1="18" y1="0" x2="18" y2="28" stroke="#111" strokeWidth="1.5" opacity="0.3"/>
            </svg>
            <div className="relative">
              <div className="flex items-center gap-2">
                <p className="text-[11px] text-white/60 uppercase tracking-wider font-semibold">Total balance</p>
                <button
                  type="button"
                  onClick={() => setBalanceHidden(!balanceHidden)}
                  className="text-white/50 hover:text-white/80 transition-colors"
                  aria-label={balanceHidden ? "Show balance" : "Hide balance"}
                >
                  {balanceHidden ? <EyeSlash size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="mt-1 text-[32px] font-bold leading-none tracking-tight tabular-nums">
                {balanceHidden ? "••••••" : account ? formatNaira(account.available) : "—"}
              </p>
              {account && account.held > 0 && (
                <p className="mt-1 text-[11px] font-medium text-white/70">
                  {formatNaira(account.held)} held in containment
                </p>
              )}
              <div className="mt-5 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Account Number</span>
                  <span className="text-[13px] tracking-widest text-white/80 font-medium">9827341029</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">This month</span>
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm shadow-sm">↑ 4.12%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-4 gap-2">
            <Link href={href("/add-money")} className="group flex flex-col items-center gap-1.5 cursor-pointer">
              <span className="flex size-12 items-center justify-center rounded-xl transition-colors bg-gray-100 text-gray-500 border border-gray-200 group-hover:bg-gray-200 dark:bg-white/[0.04] dark:text-white/50 dark:group-hover:bg-white/[0.08] dark:group-hover:text-white/70 dark:border-white/[0.04]">
                <ArrowDown size={22} weight="regular" />
              </span>
              <span className="text-[11px] font-medium text-gray-500 dark:text-white/45">Add money</span>
            </Link>

            <Link href={href("/transfer")} className="group flex flex-col items-center gap-1.5">
              <span
                style={{ backgroundColor: "var(--brand-primary, #7C3AED)" }}
                className="flex size-12 items-center justify-center rounded-xl text-white shadow-lg transition-all hover:opacity-90"
              >
                <PaperPlaneTilt size={22} weight="fill" />
              </span>
              <span className="text-[11px] font-medium text-gray-500 dark:text-white/45">Transfer</span>
            </Link>

            <Link href={href("/cards")} className="group flex flex-col items-center gap-1.5 cursor-pointer">
              <span className="flex size-12 items-center justify-center rounded-xl transition-colors bg-gray-100 text-gray-500 border border-gray-200 group-hover:bg-gray-200 dark:bg-white/[0.04] dark:text-white/50 dark:group-hover:bg-white/[0.08] dark:group-hover:text-white/70 dark:border-white/[0.04]">
                <CreditCard size={22} weight="regular" />
              </span>
              <span className="text-[11px] font-medium text-gray-500 dark:text-white/45">Cards</span>
            </Link>

            <Link href={href("/history")} className="group flex flex-col items-center gap-1.5">
              <span className="flex size-12 items-center justify-center rounded-xl transition-colors bg-gray-100 text-gray-500 border border-gray-200 group-hover:bg-gray-200 dark:bg-white/[0.04] dark:text-white/50 dark:group-hover:bg-white/[0.08] dark:group-hover:text-white/70 dark:border-white/[0.04]">
                <DotsThreeOutline size={22} weight="regular" />
              </span>
              <span className="text-[11px] font-medium text-gray-500 dark:text-white/45">More</span>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="flex flex-col gap-1.5 border-emerald-100 dark:border-emerald-500/10">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <ArrowDown size={14} weight="bold" />
                </span>
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600/70 dark:text-emerald-400/50">Income</p>
              </div>
              <p className="mt-1 text-[20px] font-bold text-gray-900 dark:text-white tabular-nums">{formatNaira(summary.income)}</p>
              <p className="text-[10px] text-gray-500 dark:text-white/30">
                {summary.incomeDeltaPct === null
                  ? "No prior month to compare"
                  : `${summary.incomeDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(summary.incomeDeltaPct)}% vs last month`}
              </p>
            </Card>
            <Card className="flex flex-col gap-1.5 border-rose-100 dark:border-rose-500/10">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                  <ArrowUp size={14} weight="bold" />
                </span>
                <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600/70 dark:text-rose-400/50">Spent</p>
              </div>
              <p className="mt-1 text-[20px] font-bold text-gray-900 dark:text-white tabular-nums">{formatNaira(summary.spent)}</p>
              <p className="text-[10px] text-gray-500 dark:text-white/30">
                {summary.income > 0 ? `${summary.spentPctOfIncome}% of income` : "No income recorded"}
              </p>
            </Card>
          </div>

          {/* Spending chart */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-bold text-gray-900 dark:text-white">Spending Analytics</p>
              <span className="text-[10px] text-gray-500 dark:text-white/25">This month</span>
            </div>
            {summary.categories.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-gray-400 dark:text-white/25">
                No spending this month yet.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {summary.categories.map((c) => (
                  <SpendBar key={c.label} label={c.label} amount={formatNaira(c.amount)} pct={c.pct} />
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right */}
        <div className="flex flex-col gap-4 lg:col-span-1">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-bold text-gray-900 dark:text-white">Recent Activity</p>
              <Link href={href("/history")} style={{ color: "var(--brand-primary, #7C3AED)" }}
                className="flex items-center gap-1 text-[11px] font-medium">
                <ClockCounterClockwise size={12} weight="bold" />
                See all
              </Link>
            </div>
            <div className="flex flex-col">
              {store === null ? <SkeletonRows /> : myTxns.map((t) => <TxnRow key={t.id} txn={t} onOpen={() => router.push(href(`/tx/${t.id}`))} />)}
            </div>
          </Card>

          {/* What Fable has learned about this customer — the same baseline
              Shield scores against, surfaced to the person it describes. */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-bold text-gray-900 dark:text-white">Your Fable profile</p>
              <Link href={href("/transparency")} style={{ color: "var(--brand-primary, #7C3AED)" }} className="text-[11px] font-medium">
                Details
              </Link>
            </div>
            {customer && baseline ? (
              <div className="flex flex-col gap-2.5">
                <ProfileRow label="Typical transfer" value={baseline.typical_transfer_range} />
                <ProfileRow label="Active hours" value={baseline.active_hours} />
                <ProfileRow label="Trusted contacts" value={`${baseline.trusted_recipients_count} recipients`} />
                <ProfileRow label="Transactions learned" value={String(baseline.transactions_analyzed)} />
              </div>
            ) : (
              <p className="py-3 text-center text-[12px] text-gray-400 dark:text-white/25">
                Building your baseline…
              </p>
            )}
          </Card>
        </div>
      </div>
    </Screen>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="shrink-0 text-gray-500 dark:text-white/40">{label}</span>
      <span className="truncate text-right font-semibold text-gray-900 dark:text-white/80">{value}</span>
    </div>
  );
}

function SpendBar({ label, amount, pct }: { label: string; amount: string; pct: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-gray-500 dark:text-white/45">{label}</span>
        <span className="text-[12px] font-bold text-gray-900 dark:text-white/70 tabular-nums">{amount}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.04]">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: "var(--brand-primary, #7C3AED)" }}
        />
      </div>
    </div>
  );
}

function TxnRow({ txn, onOpen }: { txn: Transaction; onOpen: () => void }) {
  const credit = txn.direction === "credit";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-b border-gray-100 dark:border-white/[0.04] py-3 text-left last:border-0 hover:bg-gray-50 dark:hover:bg-white/[0.02] px-2 rounded-lg transition-colors -mx-2"
    >
      <Avatar name={txn.recipientName} size="sm" />
      {/* min-w-0 lets the name truncate; the amount must never shrink, or a
          long resolved account name splits it across two lines. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{txn.recipientName}</span>
        <span className="truncate text-[11px] text-gray-500 dark:text-white/35 font-medium">{formatRelativeTime(txn.timestamp)}</span>
      </div>
      <span className={`shrink-0 whitespace-nowrap text-[13px] font-bold tabular-nums ${credit ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white/60"}`}>
        {credit ? "+" : "-"}{formatNaira(txn.amount)}
      </span>
    </button>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 py-3.5 px-2 -mx-2 border-b border-gray-100 dark:border-white/[0.04] last:border-0">
          <div className="size-10 animate-pulse rounded-full bg-gray-200 dark:bg-white/[0.04]" />
          <div className="flex flex-col gap-2">
            <div className="h-3.5 w-48 animate-pulse rounded bg-gray-200 dark:bg-white/[0.04]" />
            <div className="h-2.5 w-32 animate-pulse rounded bg-gray-100 dark:bg-white/[0.03]" />
          </div>
          <div className="ml-auto h-3.5 w-20 animate-pulse rounded bg-gray-200 dark:bg-white/[0.04]" />
        </div>
      ))}
    </>
  );
}
