"use client";

import useSWR from "swr";
import { Bank } from "@phosphor-icons/react";
import { Badge, Card, DetailRow, Eyebrow, Notice } from "@/components/app-kit";
import { API_BASE } from "@/lib/fable/base";
import { authHeaders } from "@/lib/fable/tenant";

// "Xtradot Bank (simulated)" when the local stand-in bank is used instead of the real sandbox.
const BANK_LABEL = process.env.NEXT_PUBLIC_FORGE_BANK_LABEL || "Xtradot Bank";

/**
 * What the bank did with a transfer Fable let through.
 *
 * Only a bank connected to the Xtradot Bank sandbox has this: for it, every
 * transfer money moves on is also sent to the bank, and this shows the bank's
 * own answer (reference, charges, status). For any other bank the API has no
 * such transfer and this renders nothing.
 */

type Step = { state: string; note: string | null };
type BankTransfer = {
  reference: string;
  state: string;
  fee: number | null;
  vat: number | null;
  stamp_duty: number | null;
  total_debit: number | null;
  last_error: string | null;
  trail?: Step[];
};

const FINAL = ["successful", "failed", "reversed", "cancelled"];

/** Bank charges are in kobo (VAT on a ₦25 fee is ₦1.88), so always two decimals. */
const kobo = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const LABEL: Record<string, string> = {
  decided: "Cleared by Fable",
  sending: "Sending to the bank",
  unknown: "No answer yet, asking the bank",
  pending: "Pending at the bank",
  successful: "Paid",
  failed: "Not paid",
  reversed: "Reversed",
  cancelled: "Cancelled",
};

const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  successful: "success",
  pending: "warning",
  unknown: "warning",
  sending: "warning",
  decided: "warning",
  failed: "danger",
  reversed: "neutral",
  cancelled: "neutral",
};

async function load(id: string, userId: string): Promise<BankTransfer | null> {
  const res = await fetch(
    `${API_BASE}/v1/forge/transfers/${encodeURIComponent(id)}?user_id=${encodeURIComponent(userId)}`,
    { headers: authHeaders(), cache: "no-store" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`bank status ${res.status}`);
  return (await res.json()) as BankTransfer;
}

export function BankSettlement({
  transactionId,
  userId,
  asCard = false,
  className = "",
}: {
  transactionId: string;
  userId: string | null | undefined;
  /** Wrap it in its own card (the detail page), or sit inside another (the receipt). */
  asCard?: boolean;
  className?: string;
}) {
  const { data } = useSWR(
    transactionId && userId ? ["bank-settlement", transactionId, userId] : null,
    () => load(transactionId, userId!),
    {
      // The bank settles a transfer to another bank in about five seconds, and a
      // lost answer takes longer: keep asking until the outcome is final.
      refreshInterval: (latest) => (latest && FINAL.includes(latest.state) ? 0 : 3_000),
      shouldRetryOnError: true,
    },
  );
  if (!data) return null;

  const trail = (data.trail ?? []).filter((s) => s.state !== "decided");
  const body = (
    <div className={`text-left ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bank size={18} weight="fill" className="text-brand" />
          <Eyebrow>{BANK_LABEL}</Eyebrow>
        </div>
        <Badge tone={TONE[data.state] ?? "neutral"}>{LABEL[data.state] ?? data.state}</Badge>
      </div>
      {data.fee != null && (
        <>
          <DetailRow label="Fee">{kobo(data.fee)}</DetailRow>
          <DetailRow label="VAT">{kobo(data.vat ?? 0)}</DetailRow>
          {data.stamp_duty ? <DetailRow label="Stamp duty">{kobo(data.stamp_duty)}</DetailRow> : null}
          {data.total_debit != null && <DetailRow label="Total debit">{kobo(data.total_debit)}</DetailRow>}
        </>
      )}
      <DetailRow label="Bank reference">
        <span className="break-all font-mono text-[12px]">{data.reference}</span>
      </DetailRow>
      {trail.length > 1 && (
        <p className="mt-2 text-[12px] leading-relaxed text-d-muted">
          {trail.map((s) => (s.state === "unknown" ? "No answer, so Fable asked the bank (it never resends)" : LABEL[s.state] ?? s.state)).join(" → ")}
        </p>
      )}
      {data.last_error && data.state === "failed" && (
        <Notice tone="danger" className="mt-3">{data.last_error}</Notice>
      )}
    </div>
  );
  return asCard ? <Card>{body}</Card> : body;
}
