"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CheckCircle, ShieldWarning, Ghost, ShareNetwork } from "@phosphor-icons/react";
import { Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { RiskScoreCounter } from "@/components/demo/RiskScoreCounter";
import { SignalCard } from "@/components/demo/SignalCard";
import { formatNaira, formatRiskScore } from "@/lib/fable/format";
import { commitPass, createGhost, resolvePending, useFableStore } from "@/lib/fable/store";

export default function ResultPage() {
  const router = useRouter();
  const store = useFableStore();
  const pending = store?.pending ?? null;

  useEffect(() => {
    if (store !== null && !pending) router.replace("/demo");
  }, [store, pending, router]);

  if (!pending) {
    return <div className="flex min-h-[60vh] items-center justify-center text-[13px] text-white/35">Loading...</div>;
  }

  if (pending.action === "PASS")
    return <PassResult amount={pending.amount} recipient={pending.recipientName} score={pending.riskScore} />;

  return <FlagBlockResult />;
}

function PassResult({ amount, recipient, score }: { amount: number; recipient: string; score: number }) {
  const router = useRouter();

  function done() {
    commitPass();
    router.push("/demo");
  }

  return (
    <Screen>
      <div className="relative mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-5 text-center">
        {/* Animated checkmark */}
        <div className="relative flex items-center justify-center animate-fade-in-up">
          <div className="absolute inset-0 animate-[pulse_2s_ease-in-out_infinite] rounded-full bg-emerald-500/20 blur-xl" />
          <CheckCircle size={80} weight="fill" className="text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.4)]" />
        </div>
        
        <div className="flex flex-col gap-1 animate-fade-in-up [animation-delay:0.1s]">
          <h1 className="text-[20px] font-bold text-white">Transfer sent</h1>
          <p className="text-[36px] font-bold tabular-nums text-white">{formatNaira(amount)}</p>
        </div>
        
        <p className="text-[13px] text-white/50 animate-fade-in-up [animation-delay:0.2s] max-w-[280px]">
          Fable recognized this as your regular payment to <span className="font-semibold text-white">{recipient}</span>. Cleared instantly, no friction.
        </p>

        <span className="rounded-full bg-[#1a1a1a] border border-white/[0.04] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45 animate-fade-in-up [animation-delay:0.3s]">
          Risk score {formatRiskScore(score)} · Normal
        </span>

        <div className="mt-4 flex w-full flex-col gap-2.5 animate-fade-in-up [animation-delay:0.4s]">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1a1a1a] py-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#222]"
          >
            <ShareNetwork size={16} />
            Share Receipt
          </button>
          <button
            type="button"
            onClick={done}
            className="w-full rounded-xl bg-[#7C3AED] py-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </Screen>
  );
}

function FlagBlockResult() {
  const router = useRouter();
  const store = useFableStore();
  const pending = store?.pending ?? null;
  if (!pending) return null;

  const isBlock = pending.action === "BLOCK";

  function cancel() {
    resolvePending(isBlock ? "blocked" : "cancelled");
    router.push("/demo");
  }

  async function sendAnyway() {
    await createGhost();
    router.push("/demo/ghost");
  }

  return (
    <Screen>
      <ScreenHeader title="Fable Shield" subtitle="Real-time review" backHref="/demo" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-3">
          <Card className="animate-fade-in-up">
            <div className="mb-4 flex items-start gap-3">
              <span
                className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${
                  isBlock ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400"
                }`}
              >
                <ShieldWarning size={24} weight="fill" />
              </span>
              <div>
                <h2 className="text-[16px] font-bold text-white">{isBlock ? "Transfer blocked" : "Transfer flagged"}</h2>
                <p className="text-[13px] text-white/50 mt-0.5">
                  {formatNaira(pending.amount)} to {pending.recipientName}
                </p>
              </div>
            </div>
            <RiskScoreCounter score={pending.riskScore} action={pending.action} />
          </Card>

          <Card className="animate-fade-in-up [animation-delay:0.1s]">
            <span className="text-[11px] font-medium uppercase tracking-wider text-white/35">Fable explains</span>
            <p className="mt-2 text-[13px] leading-relaxed text-white/65">{pending.explanation}</p>
          </Card>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card className="animate-fade-in-up [animation-delay:0.2s]">
            <span className="text-[11px] font-medium uppercase tracking-wider text-white/35">Signals detected</span>
            <div className="mt-3 flex flex-col gap-2">
              {pending.signals.map((s, i) => (
                <SignalCard key={s.code + i} signal={s} index={i} />
              ))}
            </div>
          </Card>

          <div className="flex flex-col gap-2.5 animate-fade-in-up [animation-delay:0.3s]">
            <button
              type="button"
              onClick={cancel}
              className="rounded-xl bg-emerald-500/10 py-3.5 text-[13px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
            >
              Cancel transfer — I&rsquo;m safe
            </button>
            <button
              type="button"
              onClick={sendAnyway}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1a1a1a] py-3 text-[13px] font-medium text-white/50 transition-colors hover:bg-[#222] hover:text-white/70"
            >
              <Ghost size={16} />
              Send anyway → Ghost protection
            </button>
          </div>
        </div>
      </div>
    </Screen>
  );
}
