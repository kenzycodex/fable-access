"use client";

import { PaperPlaneTilt, WarningCircle } from "@phosphor-icons/react";
import { DemoSheet } from "@/components/demo/DemoSheet";
import { Button, DetailRow, Notice } from "@/components/app-kit";
import { amountMagnitude, formatNaira } from "@/lib/fable/format";
import type { Recipient } from "@/lib/fable/types";

/** The check before money moves: who, how much, from what, and the reminder
 * that a sent transfer cannot be pulled back. Recheck closes it; nothing is
 * sent until the customer confirms here. */
export function ReviewSheet({ open, onClose, onConfirm, from, to, amount, available, narration, channel }: {
  open: boolean; onClose: () => void; onConfirm: () => void; from: string; to: Recipient | null; amount: number;
  available: number | null; narration: string; channel: string;
}) {
  if (!to) return null;
  const account = to.accountNumber || (to.last4 ? `•••• ${to.last4}` : "");
  return (
    <DemoSheet open={open} onClose={onClose} title="Check before you send" subtitle="Nothing is sent until you confirm">
      <div className="flex flex-col gap-4 pb-1">
        <div className="rounded-2xl bg-d-surface-2 px-4 py-5 text-center">
          <p className="text-[30px] font-bold tabular-nums text-d-text">{formatNaira(amount)}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-brand">{amountMagnitude(amount)}</p>
        </div>
        <div className="divide-y divide-d-border">
          <DetailRow label="To"><span className="font-semibold">{to.name}</span></DetailRow>
          {account && <DetailRow label="Account"><span className="tabular-nums">{account}</span></DetailRow>}
          <DetailRow label="Bank">{to.bank || "—"}</DetailRow>
          <DetailRow label="From">{from}</DetailRow>
          {narration && <DetailRow label="Narration"><span className="break-words">{narration}</span></DetailRow>}
          <DetailRow label="Sent via">{channel}</DetailRow>
          {available !== null && (
            <DetailRow label="Balance after"><span className="tabular-nums">{formatNaira(Math.max(available - amount, 0))}</span></DetailRow>
          )}
        </div>
        <Notice tone="warning" className="flex items-start gap-2 text-[12px]">
          <WarningCircle size={18} weight="fill" className="mt-0.5 shrink-0" />
          <span>
            A transfer can&apos;t be reversed once it&apos;s sent. Check the name and amount. If anyone is rushing you or
            telling you to send money to keep it safe, stop: that is how scams work.
          </span>
        </Notice>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={onClose}>Recheck</Button>
          <Button size="lg" onClick={onConfirm} icon={<PaperPlaneTilt size={18} weight="fill" />}>Confirm</Button>
        </div>
      </div>
    </DemoSheet>
  );
}
