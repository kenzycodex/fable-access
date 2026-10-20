"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Ghost, ShareNetwork, ShieldWarning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PageHeader } from "@/components/demo/PageHeader";
import { Button, Card, CardHeader, DetailRow, Eyebrow, Notice, Screen, SuccessTick } from "@/components/app-kit";
import { PageSpinner } from "@/components/demo/Spinner";
import { RiskScoreCounter } from "@/components/demo/RiskScoreCounter";
import { SignalCard } from "@/components/demo/SignalCard";
import { StepUpDialog } from "@/components/demo/StepUpDialog";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { shieldExplanation, StepUpRequiredError } from "@/lib/fable/api";
import { passMessage } from "@/lib/fable/decision";
import { formatDateTime, formatNaira, formatRiskScore } from "@/lib/fable/format";
import type { ScoreResult } from "@/lib/fable/types";
import {
  approvePending,
  commitPass,
  createGhost,
  resolvePending,
  upgradePendingExplanation,
  useFableStore,
} from "@/lib/fable/store";
import { stepUpRequirement, type StepUpRequirement } from "@/lib/fable/webauthn";

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
      // About a 7s ceiling. Past that the template is the final answer.
      if (cancelled) return;
      if (attempts >= 5) {
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
  }, [store, pending, router, href]);

  if (!pending) return <PageSpinner />;

  if (pending.action === "PASS") {
    return (
      <PassResult amount={pending.amount} recipient={pending.recipientName} bank={pending.recipientBank}
        score={pending.riskScore} baselineSource={pending.baselineSource ?? null} />
    );
  }
  return <FlagBlockResult />;
}

function PassResult({
  amount,
  recipient,
  bank,
  score,
  baselineSource,
}: {
  amount: number;
  recipient: string;
  bank: string;
  score: number;
  baselineSource: ScoreResult["baselineSource"];
}) {
  const router = useRouter();
  const { href, name } = useInstitution();
  // The moment this transfer cleared, fixed for the life of the screen.
  const [sentAt] = useState(() => Date.now());

  /** Share the receipt with the Web Share sheet where the browser has one, and
   * fall back to the clipboard on desktop. */
  async function shareReceipt() {
    const text =
      `${name} transfer receipt\n` +
      `${formatNaira(amount)} to ${recipient}\n` +
      `${new Date().toLocaleString()}\n` +
      `Checked by Fable, risk score ${formatRiskScore(score)}`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Transfer receipt", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success("Receipt copied to clipboard");
    } catch {
      // A cancelled share sheet lands here too, so stay quiet rather than
      // reporting an error the customer caused deliberately.
    }
  }

  function done() {
    commitPass();
    router.push(href());
  }

  return (
    <Screen className="flex min-h-[calc(100dvh-8rem)] items-center justify-center">
      <Card className="w-full max-w-[440px] animate-fade-in-up text-center">
        <div className="flex justify-center pt-2">
          <SuccessTick size={84} />
        </div>
        <h1 className="mt-3 text-[20px] font-bold text-d-text">Transfer sent</h1>
        <p className="mt-1 text-[40px] font-bold tabular-nums leading-tight text-d-text">{formatNaira(amount)}</p>
        <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-d-muted">
          {passMessage(baselineSource)}
        </p>

        <div className="mt-6 divide-y divide-d-border rounded-2xl bg-d-surface-2 px-4 text-left">
          <DetailRow label="To">{recipient}</DetailRow>
          <DetailRow label="Bank">{bank}</DetailRow>
          <DetailRow label="Date">{formatDateTime(sentAt)}</DetailRow>
          <DetailRow label="Risk">
            <span className="text-emerald-600 dark:text-emerald-400">Low ({formatRiskScore(score)})</span>
          </DetailRow>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Button variant="secondary" size="lg" full icon={<ShareNetwork size={18} />} onClick={shareReceipt}>
            Share receipt
          </Button>
          <Button size="lg" full onClick={done}>
            Done
          </Button>
        </div>
      </Card>
    </Screen>
  );
}

function FlagBlockResult() {
  const router = useRouter();
  const { href, customer, institutionId } = useInstitution();
  const store = useFableStore();
  const pending = store?.pending ?? null;
  const writing = usePolishedExplanation(pending?.transactionId, pending?.explanationSource === "pending");

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

  // BLOCK goes to containment. FLAG goes through verification, then completes
  // with no cooling window.
  async function sendAnyway(token?: string) {
    if (proceeding) return;
    if (isBlock) {
      setProceeding(true);
      setProceedError(null);
      try {
        await createGhost();
        router.push(href("/ghost"));
      } catch (err) {
        setProceedError(err instanceof Error ? err.message : "We couldn't hold this transfer just now. Nothing was sent.");
      } finally {
        setProceeding(false);
      }
      return;
    }
    setProceeding(true);
    setProceedError(null);
    try {
      await approvePending(token ?? null);
      router.push(href());
    } catch (err) {
      if (err instanceof StepUpRequiredError) {
        try {
          // The server answers from its own stored decision for this transfer.
          const req = await stepUpRequirement({
            userId: customer?.user_id ?? "",
            purpose: "transfer",
            reference: pending!.id,
          });
          setRequirement(req);
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
      <PageHeader
        title={isBlock ? "Transfer paused" : "Please confirm this transfer"}
        subtitle="Reviewed by Fable Shield in real time"
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          <Card className="animate-fade-in-up">
            <div className="mb-5 flex items-center gap-3.5">
              <span
                className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${
                  isBlock ? "bg-red-500/12 text-red-500" : "bg-amber-500/14 text-amber-500"
                }`}
              >
                <ShieldWarning size={26} weight="fill" />
              </span>
              <div className="min-w-0">
                <p className="text-[16px] font-bold text-d-text">
                  {formatNaira(pending.amount)} to {pending.recipientName}
                </p>
                <p className="text-[13px] text-d-muted">{pending.recipientBank}</p>
              </div>
            </div>
            <RiskScoreCounter score={pending.riskScore} action={pending.action} />
          </Card>

          {/* The choice sits right under the summary, so it is on the first screen;
              the reasons follow for anyone who wants them. */}
          <Card className="animate-fade-in-up [animation-delay:0.05s]">
            <Eyebrow className="mb-3">Your options</Eyebrow>
            <div className="flex flex-col gap-3">
              <Button variant="success" size="lg" full onClick={cancel}>
                Cancel transfer, I&apos;m safe
              </Button>
              <Button
                variant="secondary"
                size="lg"
                full
                loading={proceeding}
                onClick={() => sendAnyway()}
                icon={!proceeding ? <Ghost size={18} /> : undefined}
              >
                {isBlock ? "Send anyway, with protection" : "Send anyway, verify it's me"}
              </Button>
              <p className="text-[12px] leading-relaxed text-d-muted">
                {isBlock
                  ? "If you go ahead, the money is held safely for a short cooling window instead of being sent. You can cancel and get it back."
                  : "You'll confirm it's really you first, then the transfer goes through."}
              </p>
              {proceedError && <Notice tone="danger">{proceedError}</Notice>}
            </div>
          </Card>

          <Card className="animate-fade-in-up [animation-delay:0.1s]">
            <CardHeader
              title={isBlock ? "Why this was paused" : "Why we are asking you to confirm"}
              action={
                writing ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand">
                    <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                    Writing summary
                  </span>
                ) : undefined
              }
            />
            {/* One explanation, shown once. The instant template used to appear and
                then be replaced by the written summary a moment later, which read
                as a flicker, so a short placeholder holds the space until the
                summary is ready, and the template is the fallback if it is not. */}
            {writing ? (
              <div className="flex flex-col gap-2.5" aria-hidden>
                <span className="h-3.5 w-full animate-pulse rounded bg-d-surface-2" />
                <span className="h-3.5 w-[92%] animate-pulse rounded bg-d-surface-2" />
                <span className="h-3.5 w-[60%] animate-pulse rounded bg-d-surface-2" />
              </div>
            ) : (
              <p className="animate-fade-in-up text-[14px] leading-relaxed text-d-muted">{pending.explanation}</p>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <Card className="animate-fade-in-up [animation-delay:0.2s]">
            <CardHeader title="What Shield noticed" />
            <div className="flex flex-col gap-2.5">
              {pending.signals.length === 0 ? (
                <p className="text-[13px] text-d-muted">No individual signal stood out.</p>
              ) : (
                pending.signals.map((s, i) => <SignalCard key={s.code + i} signal={s} index={i} />)
              )}
            </div>
          </Card>

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
