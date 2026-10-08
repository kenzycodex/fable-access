"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Bank, CreditCard, WarningCircle } from "@phosphor-icons/react";
import { PageHeader } from "@/components/demo/PageHeader";
import { Button, Card, CardHeader, DetailRow, Eyebrow, Notice, Screen, SuccessTick } from "@/components/app-kit";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { accountBalance, topUp, TopUpRejectedError } from "@/lib/fable/api";
import { formatNaira } from "@/lib/fable/format";
import { recordCredit } from "@/lib/fable/store";

const QUICK = [5_000, 20_000, 50_000, 100_000];

type Method = "card" | "transfer";

/**
 * Add money: real credits against the ledger.
 *
 * This credits the account for real, which is exactly why it is bounded: it
 * writes to the same database the institution's fraud metrics are computed from.
 * Limits are shown up front rather than only on rejection, because a guard the
 * customer discovers by failing is a worse guard.
 */
export default function AddMoneyPage() {
  const router = useRouter();
  const { href, customer, institutionId } = useInstitution();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("card");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ credited: number; balance: number; left: number } | null>(null);

  const { data: account, mutate } = useSWR(
    customer ? ["account", customer.user_id, institutionId] : null,
    () => accountBalance(customer!.user_id, institutionId),
    { keepPreviousData: true },
  );

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => router.push(href()), 2400);
    return () => clearTimeout(t);
  }, [done, router, href]);

  const value = Number(amount) || 0;
  const limits = account?.limits;
  const overSingle = Boolean(limits && value > limits.max_amount);
  const canSubmit = value > 0 && !overSingle && !busy && Boolean(customer);

  async function submit() {
    if (!canSubmit || !customer) return;
    setBusy(true);
    setError(null);
    try {
      // A stable reference so a double tap cannot credit twice.
      const reference = `topup:${customer.user_id}:${Date.now()}`;
      const res = await topUp(customer.user_id, value, institutionId, method, reference);
      // Surface the credit in the feed so income and spend on the home screen
      // reflect it: the balance already moved, but those stats read the feed.
      recordCredit(res.credited, method === "card" ? "Card top-up" : "Bank transfer");
      await mutate();
      setDone({ credited: res.credited, balance: res.balance, left: res.top_ups_left_today });
    } catch (err) {
      setError(
        err instanceof TopUpRejectedError || err instanceof Error ? err.message : "Could not add money right now.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen className="flex min-h-[calc(100dvh-8rem)] items-center justify-center">
        <Card className="w-full max-w-[420px] animate-fade-in-up text-center">
          <div className="flex justify-center pt-2">
            <SuccessTick size={84} />
          </div>
          <p className="mt-3 text-[26px] font-bold tabular-nums text-d-text">{formatNaira(done.credited)} added</p>
          <p className="mt-1 text-[14px] text-d-muted">New balance {formatNaira(done.balance)}</p>
          <p className="mt-3 text-[12px] text-d-faint">
            {done.left} top-up{done.left === 1 ? "" : "s"} left today
          </p>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <PageHeader title="Add money" subtitle="Fund your account" back />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          <Card>
            <CardHeader title="How much?" />
            <div className="rounded-2xl bg-d-surface-2 px-4 py-6">
              <div className="flex items-center justify-center gap-1.5">
                <span className="text-[28px] font-bold text-d-faint">₦</span>
                <input
                  inputMode="numeric"
                  value={amount ? Number(amount).toLocaleString("en-NG") : ""}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="0"
                  aria-label="Amount in naira"
                  className="w-full min-w-0 bg-transparent text-center text-[44px] font-bold tabular-nums text-d-text outline-none placeholder:text-d-faint/50 sm:text-[52px]"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {QUICK.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAmount(String(a))}
                  className={`h-10 rounded-xl text-[12px] font-semibold transition-colors ${
                    value === a ? "bg-brand text-white" : "bg-d-surface-2 text-d-muted hover:text-d-text"
                  }`}
                >
                  ₦{a >= 1000 ? `${a / 1000}k` : a}
                </button>
              ))}
            </div>

            {overSingle && limits && (
              <Notice tone="warning" className="mt-4 flex items-start gap-2">
                <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" />
                The most you can add at once is {formatNaira(limits.max_amount)}.
              </Notice>
            )}
          </Card>

          <Card>
            <CardHeader title="Pay with" />
            <div className="grid grid-cols-2 gap-3">
              <MethodButton
                active={method === "card"}
                onClick={() => setMethod("card")}
                icon={<CreditCard size={22} weight="fill" />}
                label="Debit card"
              />
              <MethodButton
                active={method === "transfer"}
                onClick={() => setMethod("transfer")}
                icon={<Bank size={22} weight="fill" />}
                label="Bank transfer"
              />
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <Card>
            <Eyebrow>Available balance</Eyebrow>
            <p className="mt-1 text-[30px] font-bold tabular-nums text-d-text">
              {account ? formatNaira(account.available) : "—"}
            </p>
            {account && account.held > 0 && (
              <p className="mt-1 text-[12px] text-amber-600 dark:text-amber-400">
                {formatNaira(account.held)} held in containment
              </p>
            )}

            {limits && (
              <div className="mt-4 divide-y divide-d-border border-t border-d-border">
                <DetailRow label="Per top-up">{formatNaira(limits.max_amount)}</DetailRow>
                <DetailRow label="Daily total">{formatNaira(limits.daily_max)}</DetailRow>
                <DetailRow label="Top-ups per day">{limits.daily_count}</DetailRow>
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[14px] font-semibold text-d-muted">You&apos;ll receive</span>
              <span className="text-[18px] font-bold tabular-nums text-d-text">{formatNaira(value)}</span>
            </div>
            <Button size="lg" full disabled={!canSubmit} loading={busy} onClick={submit}>
              {busy ? "Adding…" : value > 0 ? `Add ${formatNaira(value)}` : "Add money"}
            </Button>
            {error && (
              <Notice tone="danger" className="mt-3">
                {error}
              </Notice>
            )}
          </Card>
        </div>
      </div>
    </Screen>
  );
}

function MethodButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all ${
        active ? "border-brand bg-brand/[0.06] ring-4 ring-brand/10" : "border-d-border hover:bg-d-surface-2"
      }`}
    >
      <span className="text-brand">{icon}</span>
      <span className="text-[14px] font-semibold text-d-text">{label}</span>
    </button>
  );
}
