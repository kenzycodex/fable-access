"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Ghost, ShieldWarning, HandPointing } from "@phosphor-icons/react";
import { Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { PageSpinner } from "@/components/demo/Spinner";
import { GhostTimer } from "@/components/demo/GhostTimer";
import { StepUpDialog } from "@/components/demo/StepUpDialog";
import { StepUpRequiredError } from "@/lib/fable/api";
import { stepUpRequirement, type StepUpRequirement } from "@/lib/fable/webauthn";
import { formatNaira } from "@/lib/fable/format";
import { cancelGhost, confirmGhost, useFableStore } from "@/lib/fable/store";
import { useInstitution } from "@/components/demo/InstitutionProvider";

const STEPS = [
  "Money frozen, not sent",
  "Recipient sees nothing",
  "Cancel to get it back",
  "Confirm only if sure",
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
  const [releaseError, setReleaseError] = useState<string | null>(null);

  useEffect(() => {
    if (store !== null && !ghost) router.replace(href());
  }, [store, ghost, router]);

  if (!ghost) {
    return <PageSpinner />;
  }

  function cancel() {
    if (!ghost) return;
    cancelGhost(ghost.id);
    router.push(href());
  }

  async function confirm(token?: string) {
    if (!ghost || releasing) return;
    setReleasing(true);
    setReleaseError(null);
    try {
      await confirmGhost(ghost.id, token ?? null);
      router.push(href());
    } catch (err) {
      if (err instanceof StepUpRequiredError) {
        // The server named the factor it wants; go and collect it.
        try {
          const req = await stepUpRequirement({
            userId: customer?.user_id ?? "",
            riskScore: 0,
            signals: [],
            purpose: "ghost_release",
          });
          setRequirement({ ...req, level: err.level, ...describeFallback(err.level, req) });
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

  /** The requirement endpoint answers for a hypothetical risk; the refusal
   * carries the real level, so prefer the server's copy for that level. */
  function describeFallback(level: string, req: StepUpRequirement) {
    if (level === req.level) return {};
    const copy: Record<string, { label: string; detail: string; factors: string[] }> = {
      pin: { label: "Transaction PIN", detail: "Re-enter your transaction PIN to release this transfer.", factors: ["pin"] },
      passkey: { label: "Device biometric", detail: "Confirm with this device's fingerprint or face unlock.", factors: ["passkey"] },
      passkey_and_otp: {
        label: "Biometric + emailed code",
        detail: "Confirm on this device, then enter the code sent to your registered email.",
        factors: ["passkey", "otp"],
      },
      identity_check: {
        label: "Identity verification",
        detail: "This transfer needs a liveness check against your registered ID.",
        factors: ["identity_check"],
      },
    };
    return copy[level] ?? {};
  }

  return (
    <Screen>
      <ScreenHeader title="Containment" subtitle="Transfer on hold" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-3">
          {/* Hero */}
          <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#1a1a1a] to-[#222] p-6 text-center text-white border border-white/[0.04]">
            <span className="relative mx-auto flex size-16 items-center justify-center rounded-full bg-white/5 text-white/80">
              <Ghost size={36} weight="fill" />
            </span>
            <p className="relative mt-4 text-[24px] font-bold tabular-nums">{formatNaira(ghost.amount)} held safely</p>
            <p className="relative mx-auto mt-1 max-w-[22rem] text-[13px] text-white/50">
              If this is a scam, the scammer gets nothing.
            </p>
          </div>

          {/* Countdown */}
          <Card>
            <p className="mb-4 text-center text-[11px] font-bold uppercase tracking-wider text-white/35">Cooling window</p>
            <GhostTimer expiresAt={ghost.expiresAt} windowSeconds={ghost.windowSeconds} />
          </Card>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card className="flex flex-col gap-2.5">
            <Row label="Status" value={<span className="font-bold text-amber-400">HELD</span>} />
            <Row label="Recipient" value={`${ghost.recipientName}`} />
            <Row label="Bank" value={ghost.recipientBank} />
          </Card>

          <Card>
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/35">How it works</span>
            <ol className="mt-3 flex flex-col gap-2.5">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-center gap-3 text-[13px] text-white/60">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/5 text-[11px] font-bold text-white/50">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          </Card>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={cancel}
              className="rounded-xl bg-red-500 py-3.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90 shadow-lg shadow-red-500/20"
            >
              Cancel &amp; get money back
            </button>
            <button
              type="button"
              onClick={() => confirm()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1a1a1a] py-3 text-[13px] font-semibold text-white/40 transition-colors hover:bg-[#222] hover:text-white/60"
            >
              <HandPointing size={16} />
              {releasing ? "Verifying…" : "I’m sure — release transfer"}
            </button>

            {/* A refused release has to be visible. Failing quietly here would
                read as the button being broken, when the money is in fact
                being held on purpose. */}
            {releaseError && (
              <p className="rounded-xl bg-red-500/10 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-400">
                {releaseError}
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
          void confirm(token);
        }}
        requirement={requirement}
        userId={customer?.user_id ?? ""}
        institutionId={institutionId}
        purpose="ghost_release"
        reference={ghost.id}
      />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-white/40">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}
