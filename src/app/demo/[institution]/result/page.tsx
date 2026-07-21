"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle, ShieldWarning, Ghost, ShareNetwork } from "@phosphor-icons/react";
import { Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { RiskScoreCounter } from "@/components/demo/RiskScoreCounter";
import { SignalCard } from "@/components/demo/SignalCard";
import { shieldExplanation, StepUpRequiredError } from "@/lib/fable/api";
import { stepUpRequirement, type StepUpRequirement } from "@/lib/fable/webauthn";
import { StepUpDialog } from "@/components/demo/StepUpDialog";
import { formatNaira, formatRiskScore } from "@/lib/fable/format";
import {
  approvePending,
  commitPass,
  createGhost,
  resolvePending,
  upgradePendingExplanation,
  useFableStore,
} from "@/lib/fable/store";
import { useInstitution } from "@/components/demo/InstitutionProvider";

/** Collect the fuller write-up Shield is generating off the request path.
 *
 * The verdict, score and signals are already on screen; only the prose is
 * outstanding. Polls until it lands, then stops. If it never lands, the
 * deterministic explanation already showing stays put, which is complete and
 * accurate in its own right, so there is no error state to surface here.
 */
function usePolishedExplanation(transactionId: string | undefined, isPending: boolean) {
  // The id whose write-up has landed (or given up). Deriving `writing` from it
  // avoids setting state synchronously in the effect, and it resets naturally
  // when a new transfer brings a new id.
  const [resolvedId, setResolvedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending || !transactionId) return;
    let cancelled = false;
    let attempts = 0;

    async function poll() {
      // ~18s ceiling. Past that the template is the final answer.
      if (cancelled) return;
      if (attempts >= 12) {
        setResolvedId(transactionId!);
        return;
      }
      attempts += 1;
      const result = await shieldExplanation(transactionId!);
      if (cancelled) return;
      if (result?.ready && result.explanation) {
        upgradePendingExplanation(transactionId!, result.explanation);
        setResolvedId(transactionId!);
        return;
      }
      setTimeout(poll, 1500);
    }

    const first = setTimeout(poll, 1200);
    return () => {
      cancelled = true;
      clearTimeout(first);
    };
  }, [transactionId, isPending]);

  return isPending && !!transactionId && resolvedId !== transactionId;
}

export default function ResultPage() {
  const { href } = useInstitution();
  const router = useRouter();
  const store = useFableStore();
  const pending = store?.pending ?? null;

  useEffect(() => {
    if (store !== null && !pending) router.replace(href());
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
  const { href } = useInstitution();

  function done() {
    commitPass();
    router.push(href());
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
            className="w-full rounded-xl bg-[var(--brand-primary)] py-3.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
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
  const { href, customer, institutionId } = useInstitution();
  const store = useFableStore();
  const pending = store?.pending ?? null;
  const writing = usePolishedExplanation(
    pending?.transactionId,
    pending?.explanationSource === "pending",
  );

  // A flag is verified and sent directly; only a block is contained.
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [requirement, setRequirement] = useState<StepUpRequirement | null>(null);
  const [proceeding, setProceeding] = useState(false);
  const [proceedError, setProceedError] = useState<string | null>(null);

  if (!pending) return null;

  const isBlock = pending.action === "BLOCK";

  function cancel() {
    resolvePending(isBlock ? "blocked" : "cancelled");
    router.push(href());
  }

  // BLOCK → containment. FLAG → verify, then complete with no cooling window.
  async function sendAnyway(token?: string) {
    if (isBlock) {
      await createGhost();
      router.push(href("/ghost"));
      return;
    }
    if (proceeding) return;
    setProceeding(true);
    setProceedError(null);
    try {
      await approvePending(token ?? null);
      router.push(href());
    } catch (err) {
      if (err instanceof StepUpRequiredError) {
        try {
          const req = await stepUpRequirement({
            userId: customer?.user_id ?? "",
            riskScore: pending!.riskScore,
            signals: pending!.signals.map((s) => s.code),
            action: "FLAG",
            purpose: "transfer",
          });
          setRequirement({ ...req, level: err.level });
        } catch {
          setRequirement(null);
        }
        setStepUpOpen(true);
      } else {
        setProceedError(err instanceof Error ? err.message : "Could not send this transfer.");
      }
    } finally {
      setProceeding(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Fable Shield" subtitle="Real-time review" />

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
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-white/35">Fable explains</span>
              {writing && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--brand-primary)]">
                  <span className="size-1.5 animate-pulse rounded-full bg-[var(--brand-primary)]" />
                  Adding detail
                </span>
              )}
            </div>
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
              onClick={() => sendAnyway()}
              disabled={proceeding}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1a1a1a] py-3 text-[13px] font-medium text-white/50 transition-colors hover:bg-[#222] hover:text-white/70 disabled:opacity-50"
            >
              <Ghost size={16} />
              {isBlock
                ? "Send anyway → Ghost protection"
                : proceeding
                  ? "Verifying…"
                  : "Send anyway → verify it's you"}
            </button>
            {proceedError && (
              <p className="rounded-xl bg-red-500/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-400">
                {proceedError}
              </p>
            )}
          </div>
        </div>
      </div>

      <StepUpDialog
        open={stepUpOpen}
        onClose={() => setStepUpOpen(false)}
        onVerified={(token) => {
          setStepUpOpen(false);
          void sendAnyway(token);
        }}
        requirement={requirement}
        userId={customer?.user_id ?? ""}
        institutionId={institutionId}
        purpose="transfer"
        reference={pending.id}
      />
    </Screen>
  );
}
