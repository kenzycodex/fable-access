"use client";

import { PaperPlaneTilt, WarningCircle } from "@phosphor-icons/react";
import { DemoSheet } from "@/components/demo/DemoSheet";
import { Button, DetailRow, Notice } from "@/components/app-kit";
import { amountMagnitude, formatNaira } from "@/lib/fable/format";
import type { Recipient } from "@/lib/fable/types";

/** The check before money moves: who, how much, from what, and the reminder
 * that a sent transfer cannot be pulled back. Recheck closes it; nothing is
 * sent until the customer confirms here.
 *
 * Short enough to read without scrolling on a laptop. The scam warning shows
 * only when it applies (a new recipient, or most of the balance leaving), so it
 * is not wallpaper on every transfer; the one-line reminder always shows. */
export function ReviewSheet({ open, onClose, onConfirm, from, to, amount, available, narration, channel }: {
  open: boolean; onClose: () => void; onConfirm: () => void; from: string; to: Recipient | null; amount: number;
  available: number | null; narration: string; channel: string;
}) {
  if (!to) return null;
  const account = to.accountNumber || to.last4 || "";
  const drains = available !== null && available > 0 && amount >= available * 0.8;
  const caution = !to.known || drains;
  return (
    <DemoSheet open={open} onClose={onClose} title="Check before you send" subtitle="Nothing is sent until you confirm">
      <div className="flex flex-col gap-3 pb-1">
        <div className="rounded-2xl bg-d-surface-2 px-4 py-3 text-center">
          <p className="text-[26px] font-bold leading-tight tabular-nums text-d-text">{formatNaira(amount)}</p>
          <p className="text-[12px] font-semibold text-brand">{amountMagnitude(amount)}</p>
        </div>
        <div className="divide-y divide-d-border [&>div]:py-2">
          <DetailRow label="To"><span className="font-semibold">{to.name}</span></DetailRow>
          <DetailRow label="Account">
            <span className="tabular-nums">{[account, to.bank].filter(Boolean).join(" · ") || "—"}</span>
          </DetailRow>
          <DetailRow label="From">{channel ? `${from} · ${channel}` : from}</DetailRow>
          {narration && <DetailRow label="Narration"><span className="break-words">{narration}</span></DetailRow>}
          {available !== null && (
            <DetailRow label="Balance after"><span className="tabular-nums">{formatNaira(Math.max(available - amount, 0))}</span></DetailRow>
          )}
        </div>
        {caution ? (
          <Notice tone="warning" className="flex items-start gap-2 !px-3 !py-2 text-[12px] !leading-snug">
            <WarningCircle size={16} weight="fill" className="mt-px shrink-0" />
            <span>
              {!to.known ? "First transfer to this account. " : "This leaves little in your account. "}
              A transfer can&apos;t be reversed once it&apos;s sent. If anyone is rushing you, stop: that is how scams work.
            </span>
          </Notice>
        ) : (
          <p className="text-center text-[12px] text-d-muted">A transfer can&apos;t be reversed once it&apos;s sent.</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={onClose}>Recheck</Button>
          <Button size="lg" onClick={onConfirm} icon={<PaperPlaneTilt size={18} weight="fill" />}>Confirm</Button>
        </div>
      </div>
    </DemoSheet>
  );
}
