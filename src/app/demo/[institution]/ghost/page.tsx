"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Ghost, ShieldWarning, HandPointing } from "@phosphor-icons/react";
import { Card, Screen, ScreenHeader } from "@/components/demo/kit";
import { GhostTimer } from "@/components/demo/GhostTimer";
import { formatNaira } from "@/lib/fable/format";
import { cancelGhost, confirmGhost, useFableStore } from "@/lib/fable/store";
import { useInstitution } from "@/components/demo/InstitutionProvider";

const STEPS = [
  "Money frozen — not sent yet",
  "Recipient sees nothing",
  "Cancel anytime to get it back",
  "Confirm only if you're sure",
];

export default function GhostPage() {
  const { href } = useInstitution();
  const router = useRouter();
  const store = useFableStore();
  const ghost = store?.ghosts.find((g) => g.status === "held") ?? null;

  useEffect(() => {
    if (store !== null && !ghost) router.replace(href());
  }, [store, ghost, router]);

  if (!ghost) {
    return <div className="flex min-h-[60vh] items-center justify-center text-[13px] text-white/35">Loading...</div>;
  }

  function cancel() {
    if (!ghost) return;
    cancelGhost(ghost.id);
    router.push(href());
  }

  function confirm() {
    if (!ghost) return;
    confirmGhost(ghost.id);
    router.push(href());
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
            <p className="relative mx-auto mt-1 max-w-xs text-[13px] text-white/50">
              Even if this is a scam, the scammer gets nothing. Your money stays with you until confirmed.
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
              onClick={confirm}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1a1a1a] py-3 text-[13px] font-semibold text-white/40 transition-colors hover:bg-[#222] hover:text-white/60"
            >
              <HandPointing size={16} />
              I&rsquo;m sure — release transfer
            </button>
          </div>
        </div>
      </div>
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
