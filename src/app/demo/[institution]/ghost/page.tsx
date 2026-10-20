"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Ghost, HandPointing } from "@phosphor-icons/react";
import { PageHeader } from "@/components/demo/PageHeader";
import { Badge, Button, Card, CardHeader, DetailRow, Eyebrow, Notice, Screen } from "@/components/app-kit";
import { PageSpinner } from "@/components/demo/Spinner";
import { GhostTimer } from "@/components/demo/GhostTimer";
import { StepUpDialog } from "@/components/demo/StepUpDialog";
import { GhostExpiredError, ghostDetail, ghostRequestRelease, StepUpRequiredError } from "@/lib/fable/api";
import { stepUpRequirement, type StepUpRequirement } from "@/lib/fable/webauthn";
import { formatNaira } from "@/lib/fable/format";
import { cancelGhost, confirmGhost, markGhostEnded, useFableStore } from "@/lib/fable/store";
import { useInstitution } from "@/components/demo/InstitutionProvider";

const STEPS = [
  "The money is held, not sent",
  "The recipient sees nothing",
  "Cancel to get it back instantly",
  "Release only if you're certain",
];

export default function GhostPage() {
  const { href, customer, institutionId } = useInstitution();
  const router = useRouter();
  const store = useFableStore();
  const ghost = store?.ghosts.find((g) => g.status === "held") ?? null;

  // Releasing money out of containment is the one action an attacker in the
  // session actually wants, so it costs a factor the session can't produce.
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [requirement, setRequirement] = useState<StepUpRequirement | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [askedBank, setAskedBank] = useState(false);

  useEffect(() => {
    if (store !== null && !ghost && !ended) router.replace(href());
  }, [store, ghost, router, href, ended]);

  if (ended) {
    return (
      <Screen>
        <PageHeader title="Hold ended" subtitle="Nothing was sent" back />
        <Card className="flex flex-col gap-4">
          <Notice tone="neutral">{ended}</Notice>
          <Button size="lg" full onClick={() => router.push(href())}>
            Back to home
          </Button>
        </Card>
      </Screen>
    );
  }

  if (!ghost) {
    return <PageSpinner />;
  }

  async function cancel() {
    if (!ghost || cancelling) return;
    setCancelling(true);
    setReleaseError(null);
    try {
      await cancelGhost(ghost.id);
      router.push(href());
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : "We couldn't cancel just now. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  /** The window closed on screen: ask the server what happened, since it is
   * the server that ends the hold. */
  async function checkExpiry() {
    if (!ghost) return;
    try {
      const fresh = await ghostDetail(ghost.id);
      if (fresh.status === "EXPIRED") {
        markGhostEnded(ghost.id, "expired");
        setEnded(new GhostExpiredError().message);
      }
    } catch {
      // Unreachable: leave the screen as it is; release will say what happened.
    }
  }

  async function confirm(token?: string) {
    if (!ghost || releasing) return;
    setReleasing(true);
    setReleaseError(null);
    try {
      await confirmGhost(ghost.id, token ?? null);
      router.push(href());
    } catch (err) {
      if (err instanceof GhostExpiredError) {
        markGhostEnded(ghost.id, "expired");
        setEnded(err.message);
        return;
      }
      if (err instanceof StepUpRequiredError) {
        // The server named the factor it wants; go and collect it.
        try {
          // The server answers from the hold it stored, including which of the
          // customer's factors were in place before the money was held.
          const req = await stepUpRequirement({
            userId: customer?.user_id ?? "",
            purpose: "ghost_release",
            reference: ghost!.id,
          });
          setRequirement(req);
        } catch {
          setRequirement(null);
        }
        setStepUpOpen(true);
      } else {
        setReleaseError(
          err instanceof Error ? err.message : "Could not release this transfer.",
        );
      }
    } finally {
      setReleasing(false);
    }
  }

  return (
    <Screen>
      <PageHeader title="Funds on hold" subtitle="Your transfer is paused, not sent" back />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          <Card className="text-center">
            <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-brand/12 text-brand">
              <Ghost size={34} weight="fill" />
            </span>
            <p className="mt-4 text-[30px] font-bold tabular-nums text-d-text">{formatNaira(ghost.amount)}</p>
            <p className="mx-auto mt-1 max-w-[340px] text-[14px] text-d-muted">
              is being held safely. If this was a scam, the scammer gets nothing.
            </p>
          </Card>

          {/* The two choices sit right under the held amount, on the first
              screen; the timer and the details follow. */}
          <Card className="flex flex-col gap-3">
            <Button variant="danger" size="lg" full loading={cancelling} disabled={releasing} onClick={() => void cancel()}>
              Cancel and get my money back
            </Button>
            <Button
              variant="secondary"
              size="lg"
              full
              loading={releasing}
              disabled={cancelling}
              onClick={() => confirm()}
              icon={!releasing ? <HandPointing size={18} /> : undefined}
            >
              I&apos;m sure, release the transfer
            </Button>
            {askedBank && (
              <Notice tone="neutral">
                We&apos;ve asked your bank to verify you. They may call you on the number they have on file. The money
                stays held until they release it, and you can still cancel.
              </Notice>
            )}
            {/* A refused release has to be visible. Failing quietly would read as
                a broken button, when the money is in fact being held on purpose. */}
            {releaseError && <Notice tone="danger">{releaseError}</Notice>}
          </Card>

          <Card>
            <CardHeader title="Cooling window" subtitle="Cancel any time before it ends" />
            <GhostTimer expiresAt={ghost.expiresAt} windowSeconds={ghost.windowSeconds} onExpire={() => void checkExpiry()} />
          </Card>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <Card>
            <CardHeader title="Transfer" action={<Badge tone="warning">On hold</Badge>} />
            <div className="divide-y divide-d-border">
              <DetailRow label="Recipient">{ghost.recipientName}</DetailRow>
              <DetailRow label="Bank">{ghost.recipientBank}</DetailRow>
              <DetailRow label="Amount">{formatNaira(ghost.amount)}</DetailRow>
            </div>
          </Card>

          <Card>
            <Eyebrow className="mb-3">How it works</Eyebrow>
            <ol className="flex flex-col gap-3">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-center gap-3 text-[13px] text-d-muted">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/12 text-[11px] font-bold text-brand">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </Card>

        </div>
      </div>

      <StepUpDialog
        open={stepUpOpen}
        onClose={() => setStepUpOpen(false)}
        onVerified={(token) => {
          setStepUpOpen(false);
          void confirm(token);
        }}
        requirement={requirement}
        userId={customer?.user_id ?? ""}
        institutionId={institutionId}
        purpose="ghost_release"
        reference={ghost.id}
        onCancelTransfer={() => {
          setStepUpOpen(false);
          void cancel();
        }}
        onAskBank={async () => {
          await ghostRequestRelease(ghost.id);
          setAskedBank(true);
          setStepUpOpen(false);
        }}
      />
    </Screen>
  );
}
