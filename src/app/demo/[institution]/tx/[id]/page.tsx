"use client";

import { useRouter, useParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Ghost as GhostIcon, ShieldCheck } from "@phosphor-icons/react";
import { Card, Screen, ScreenHeader, Avatar } from "@/components/demo/kit";
import { PageSpinner } from "@/components/demo/Spinner";
import { SignalCard } from "@/components/demo/SignalCard";
import { customerTransactions } from "@/lib/fable/api";
import { formatNaira, formatRelativeTime } from "@/lib/fable/format";
import { useFableStore } from "@/lib/fable/store";
import type { Transaction, TransactionStatus } from "@/lib/fable/types";
import { useInstitution } from "@/components/demo/InstitutionProvider";

const STATUS_META: Record<TransactionStatus, { label: string; chip: string }> = {
  completed: { label: "Sent", chip: "bg-emerald-500/15 text-emerald-500" },
  flagged: { label: "Flagged", chip: "bg-amber-500/15 text-amber-500" },
  blocked: { label: "Blocked", chip: "bg-red-500/15 text-red-500" },
  cancelled: { label: "Cancelled", chip: "bg-gray-400/15 text-gray-400" },
  held: { label: "In containment", chip: "bg-[var(--brand-primary)]/15 text-[var(--brand-primary)]" },
  released: { label: "Released", chip: "bg-emerald-500/15 text-emerald-500" },
};

export default function TransactionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? "");
  const { href, customer, institutionId } = useInstitution();
  const store = useFableStore();

  const { data: serverTxns } = useSWR(
    customer ? ["demo:tx-detail", customer.user_id, institutionId] : null,
    () => customerTransactions(customer!.user_id, institutionId, 200),
    { refreshInterval: 8_000, keepPreviousData: true },
  );

  // Session transfers win — they carry the freshest status before the next poll.
  const local = (store?.transactions ?? []).find((t) => t.id === id) ?? null;
  const txn: Transaction | null = local ?? (serverTxns ?? []).find((t) => t.id === id) ?? null;

  // A live hold for this transfer is reachable from here. The Ghost screen
  // owns expiry; a still-"held" container is one the customer can still act on.
  const heldGhost = (store?.ghosts ?? []).find(
    (g) => g.transactionId === id && g.status === "held",
  );

  if (store !== null && !txn) {
    return (
      <Screen>
        <ScreenHeader title="Transfer" />
        <Card>
          <p className="text-[13px] text-gray-500 dark:text-white/40">This transfer isn&apos;t in your history.</p>
          <button type="button" onClick={() => router.push(href("/history"))} className="mt-3 text-[13px] font-semibold text-[var(--brand-primary)]">
            Back to activity
          </button>
        </Card>
      </Screen>
    );
  }

  if (!txn) {
    return (
      <Screen>
        <PageSpinner minh="50vh" />
      </Screen>
    );
  }

  const status = STATUS_META[txn.status] ?? STATUS_META.completed;
  const credit = txn.direction === "credit";
  const flagged = txn.action !== "PASS";

  return (
    <Screen>
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-gray-500 hover:text-gray-900 dark:text-white/40 dark:hover:text-white"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-5 lg:gap-5">
        <div className="flex flex-col gap-4 lg:col-span-3">
          {/* Summary */}
          <Card>
            <div className="flex items-center gap-3">
              <Avatar name={txn.recipientName} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-gray-900 dark:text-white">{txn.recipientName}</p>
                <p className="text-[12px] text-gray-500 dark:text-white/40">{txn.recipientBank}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${status.chip}`}>
                {status.label}
              </span>
            </div>
            <div className="mt-4 border-t border-gray-100 dark:border-white/[0.05] pt-4">
              <p className={`text-[28px] font-bold tabular-nums ${credit ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white"}`}>
                {credit ? "+" : "-"}
                {formatNaira(txn.amount)}
              </p>
              <p className="mt-1 text-[12px] text-gray-500 dark:text-white/40">
                {formatRelativeTime(txn.timestamp)}
                {txn.narration ? ` · ${txn.narration}` : ""}
              </p>
            </div>
          </Card>

          {/* Live containment access */}
          {heldGhost && (
            <Card className="border-[var(--brand-primary)]/25 bg-[var(--brand-primary)]/[0.04]">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--brand-primary)]/15 text-[var(--brand-primary)]">
                  <GhostIcon size={20} weight="fill" />
                </span>
                <div className="flex-1">
                  <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Held in containment</p>
                  <p className="text-[11px] text-gray-500 dark:text-white/40">The cooling window is still open. You can cancel or release it.</p>
                </div>
                <button
                  type="button"
                  onClick={() => router.push(href("/ghost"))}
                  className="rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90"
                >
                  Open
                </button>
              </div>
            </Card>
          )}

          {/* Fable's explanation */}
          {txn.explanation && (
            <Card>
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-white/35">Fable explains</span>
              <p className="mt-2 text-[13px] leading-relaxed text-gray-600 dark:text-white/60">{txn.explanation}</p>
            </Card>
          )}
        </div>

        {/* Decision */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={16} weight="fill" className="text-[var(--brand-primary)]" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-white/35">Fable decision</span>
            </div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-gray-500 dark:text-white/45">Risk score</span>
              <span className="font-bold tabular-nums text-gray-900 dark:text-white">{txn.riskScore.toFixed(2)}</span>
            </div>
            {flagged && txn.signals.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {txn.signals.map((s, i) => (
                  <SignalCard key={s.code + i} signal={s} index={0} />
                ))}
              </div>
            )}
            {!flagged && (
              <p className="mt-2 text-[12px] text-gray-500 dark:text-white/40">Cleared with no risk signals.</p>
            )}
          </Card>
        </div>
      </div>
    </Screen>
  );
}
