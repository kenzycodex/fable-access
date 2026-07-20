"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Bank, CheckCircle, CreditCard, WarningCircle } from "@phosphor-icons/react";
import { Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { accountBalance, topUp, TopUpRejectedError } from "@/lib/fable/api";
import { formatNaira } from "@/lib/fable/format";

const QUICK = [5_000, 20_000, 50_000, 100_000];

type Method = "card" | "transfer";

/**
 * Add Money — real credits against the ledger.
 *
 * This previously ran a 1.5s timer and redirected without adding anything.
 * It now credits the account for real, which is exactly why it is bounded: it
 * writes to the same database the institution's fraud metrics are computed
 * from. Limits are shown up front rather than only on rejection, because a
 * guard the customer discovers by failing is a worse guard.
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
    const t = setTimeout(() => router.push(href()), 2200);
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
      // Stable reference so a double-tap cannot credit twice.
      const reference = `topup:${customer.user_id}:${Date.now()}`;
      const res = await topUp(customer.user_id, value, institutionId, method, reference);
      await mutate();
      setDone({ credited: res.credited, balance: res.balance, left: res.top_ups_left_today });
    } catch (err) {
      setError(
        err instanceof TopUpRejectedError || err instanceof Error
          ? err.message
          : "Could not add money right now.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <ScreenHeader title="Add money" />
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle size={56} weight="fill" className="animate-check-pop text-emerald-500" />
          <p className="text-[22px] font-bold text-gray-900 dark:text-white">
            {formatNaira(done.credited)} added
          </p>
          <p className="text-[13px] text-gray-500 dark:text-white/45">
            New balance {formatNaira(done.balance)}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-white/25">
            {done.left} top-up{done.left === 1 ? "" : "s"} left today
          </p>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Add money" subtitle="Fund your account" />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:gap-5">
        <div className="flex flex-col gap-4 lg:col-span-3">
          <Card>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">
              Amount
            </p>
            <div className="flex items-center justify-center gap-1 py-3">
              <span className="text-[24px] font-bold text-gray-400 dark:text-white/15">₦</span>
              <input
                inputMode="numeric"
                value={amount ? Number(amount).toLocaleString("en-NG") : ""}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="0"
                className="w-full bg-transparent text-center text-[40px] font-bold tabular-nums text-gray-900 outline-none placeholder:text-gray-300 dark:text-white dark:placeholder:text-white/10"
              />
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {QUICK.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAmount(String(a))}
                  className={`rounded-lg border py-2.5 text-[11px] font-semibold transition-colors ${
                    value === a
                      ? "border-transparent text-white"
                      : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 dark:border-white/[0.04] dark:bg-[#111] dark:text-white/35 dark:hover:bg-[#222]"
                  }`}
                  style={value === a ? { backgroundColor: "var(--brand-primary, #7C3AED)" } : undefined}
                >
                  ₦{a >= 1000 ? `${a / 1000}k` : a}
                </button>
              ))}
            </div>

            {overSingle && limits && (
              <p className="mt-3 flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" />
                Single top-up limit is {formatNaira(limits.max_amount)}.
              </p>
            )}
          </Card>

          <Card>
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">
              Method
            </p>
            <div className="grid grid-cols-2 gap-2">
              <MethodButton
                active={method === "card"}
                onClick={() => setMethod("card")}
                icon={<CreditCard size={18} weight="fill" />}
                label="Debit card"
              />
              <MethodButton
                active={method === "transfer"}
                onClick={() => setMethod("transfer")}
                icon={<Bank size={18} weight="fill" />}
                label="Bank transfer"
              />
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-white/25">
              Available balance
            </p>
            <p className="mt-1 text-[26px] font-bold tabular-nums text-gray-900 dark:text-white">
              {account ? formatNaira(account.available) : "—"}
            </p>
            {account && account.held > 0 && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                {formatNaira(account.held)} held in containment
              </p>
            )}

            {limits && (
              <div className="mt-4 flex flex-col gap-1.5 border-t border-gray-200 pt-3 text-[11px] text-gray-500 dark:border-white/[0.05] dark:text-white/35">
                <Limit label="Per top-up" value={formatNaira(limits.max_amount)} />
                <Limit label="Daily total" value={formatNaira(limits.daily_max)} />
                <Limit label="Daily count" value={`${limits.daily_count} top-ups`} />
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-4 flex items-center justify-between text-[14px]">
              <span className="font-bold text-gray-700 dark:text-white/60">You&apos;ll receive</span>
              <span className="font-bold tabular-nums text-gray-900 dark:text-white">
                {formatNaira(value)}
              </span>
            </div>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="w-full rounded-xl py-3.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-white/[0.05] dark:disabled:text-white/20"
              style={canSubmit ? { backgroundColor: "var(--brand-primary, #7C3AED)" } : undefined}
            >
              {busy ? "Adding…" : `Add ${formatNaira(value)}`}
            </button>

            {error && (
              <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-600 dark:bg-red-500/10 dark:text-red-400">
                {error}
              </p>
            )}
          </Card>
        </div>
      </div>
    </Screen>
  );
}

function MethodButton({
  active, onClick, icon, label,
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
      className={`flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-colors ${
        active
          ? "border-[#7C3AED]/40 bg-[#7C3AED]/[0.07]"
          : "border-gray-200 hover:bg-gray-50 dark:border-white/[0.06] dark:hover:bg-white/[0.03]"
      }`}
    >
      <span className="text-[#7C3AED]">{icon}</span>
      <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{label}</span>
    </button>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="font-semibold text-gray-700 dark:text-white/60">{value}</span>
    </div>
  );
}
