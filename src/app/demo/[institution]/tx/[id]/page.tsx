"use client";

import { useRouter, useParams } from "next/navigation";
import { BankSettlement } from "@/components/demo/BankSettlement";
import useSWR from "swr";
import { Ghost as GhostIcon, ShieldCheck } from "@phosphor-icons/react";
import { PageHeader } from "@/components/demo/PageHeader";
import { Avatar, Button, ButtonLink, Card, CardHeader, DetailRow, Eyebrow, Screen } from "@/components/app-kit";
import { PageSpinner } from "@/components/demo/Spinner";
import { SignalCard } from "@/components/demo/SignalCard";
import { customerTransactions } from "@/lib/fable/api";
import { formatDateTime, formatNaira } from "@/lib/fable/format";
import { useFableStore } from "@/lib/fable/store";
import type { Transaction } from "@/lib/fable/types";
import { statusTone } from "@/lib/fable/ui";
import { useInstitution } from "@/components/demo/InstitutionProvider";

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
        <PageHeader title="Transfer" back={href("/history")} />
        <Card>
          <p className="text-[14px] text-d-muted">This transfer isn&apos;t in your history.</p>
          <ButtonLink href={href("/history")} variant="secondary" size="sm" className="mt-4">
            Back to activity
          </ButtonLink>
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

  const tone = statusTone(txn.status);
  const credit = txn.direction === "credit";
  const flagged = txn.action !== "PASS";

  return (
    <Screen>
      <PageHeader title="Transfer details" subtitle={formatDateTime(txn.timestamp)} back={href("/history")} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          <Card>
            <div className="flex items-center gap-3.5">
              <Avatar name={txn.recipientName} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-bold text-d-text">{txn.recipientName}</p>
                <p className="text-[13px] text-d-muted">{txn.recipientBank}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${tone.chip}`}>{tone.label}</span>
            </div>
            <p
              className={`mt-5 text-[36px] font-bold tabular-nums ${
                credit ? "text-emerald-600 dark:text-emerald-400" : "text-d-text"
              }`}
            >
              {credit ? "+" : "-"}
              {formatNaira(txn.amount)}
            </p>
            <div className="mt-4 divide-y divide-d-border border-t border-d-border">
              <DetailRow label="Date">{formatDateTime(txn.timestamp)}</DetailRow>
              {txn.narration && <DetailRow label="Narration">{txn.narration}</DetailRow>}
              <DetailRow label="Account">
                <span className="font-mono tabular-nums">{txn.recipientAccount || "-"}</span>
              </DetailRow>
            </div>
          </Card>

          {/* Live containment access */}
          {heldGhost && (
            <Card className="border-brand/30 bg-brand/[0.05]">
              <div className="flex items-center gap-3.5">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
                  <GhostIcon size={22} weight="fill" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-d-text">Held in containment</p>
                  <p className="text-[12px] text-d-muted">The cooling window is still open. You can cancel or release it.</p>
                </div>
                <Button size="sm" onClick={() => router.push(href("/ghost"))}>
                  Open
                </Button>
              </div>
            </Card>
          )}

          {txn.explanation && (
            <Card>
              <CardHeader title="Why Fable stepped in" />
              <p className="text-[14px] leading-relaxed text-d-muted">{txn.explanation}</p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck size={18} weight="fill" className="text-brand" />
              <Eyebrow>Fable decision</Eyebrow>
            </div>
            <DetailRow label="Risk score">
              <span className="font-bold tabular-nums">{txn.riskScore.toFixed(2)}</span>
            </DetailRow>
            {flagged && txn.signals.length > 0 ? (
              <div className="mt-3 flex flex-col gap-2.5">
                {txn.signals.map((s, i) => (
                  <SignalCard key={s.code + i} signal={s} index={0} />
                ))}
              </div>
            ) : (
              !flagged && <p className="mt-2 text-[13px] text-d-muted">Cleared with no risk signals.</p>
            )}
          </Card>
          <BankSettlement transactionId={txn.id} userId={customer?.user_id} asCard />
        </div>
      </div>
    </Screen>
  );
}
