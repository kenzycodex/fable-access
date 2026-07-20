// Shared risk-state presentation, so the demo bank and dashboard color and
// label PASS / FLAG / BLOCK identically. Values reference existing brand
// tokens only (accent/mint, neutral/amber, danger/red).

import type { RiskAction } from "./types";

export interface RiskTone {
  /** Verdict word shown to users. */
  label: string;
  /** Text color class. */
  text: string;
  /** Soft background chip class. */
  chip: string;
  /** Border class for cards/rings. */
  border: string;
  /** Raw hex for canvas/inline styles (progress fills, etc.). */
  hex: string;
}

export const RISK_TONE: Record<RiskAction, RiskTone> = {
  PASS: {
    label: "Low risk",
    text: "text-success",
    chip: "bg-success/15 text-success",
    border: "border-success",
    hex: "#00f5a0",
  },
  FLAG: {
    label: "Flagged",
    text: "text-neutral",
    chip: "bg-neutral/15 text-neutral",
    border: "border-neutral",
    hex: "#ffb547",
  },
  BLOCK: {
    label: "Blocked",
    text: "text-danger",
    chip: "bg-danger/15 text-danger",
    border: "border-danger",
    hex: "#ff3b5c",
  },
};

export function riskTone(action: RiskAction): RiskTone {
  return RISK_TONE[action];
}

/**
 * One tone per transaction outcome, used everywhere a status renders.
 *
 * `released` is deliberately not green. It succeeded, but only after the
 * customer overrode a block and sat through a cooling window — a risk team
 * should be able to pick those out of a list at a glance, and colouring them
 * the same as an ordinary cleared transfer hides exactly the cases worth
 * reviewing.
 */
export type StatusTone = {
  label: string;
  chip: string;
  dot: string;
  amount: string;
};

const STATUS_TONES: Record<string, StatusTone> = {
  completed: {
    label: "Completed",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20",
    dot: "bg-emerald-500",
    amount: "text-gray-900 dark:text-white/70",
  },
  released: {
    label: "Released",
    chip: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20",
    dot: "bg-blue-500",
    amount: "text-blue-600 dark:text-blue-400",
  },
  held: {
    label: "Held",
    chip: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20",
    dot: "bg-amber-500",
    amount: "text-amber-600 dark:text-amber-400",
  },
  cancelled: {
    label: "Cancelled",
    chip: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/[0.06] dark:text-white/45 dark:border-white/[0.08]",
    dot: "bg-slate-400",
    amount: "text-slate-500 line-through dark:text-white/35",
  },
  blocked: {
    label: "Blocked",
    chip: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20",
    dot: "bg-red-500",
    amount: "text-red-600 line-through dark:text-red-400",
  },
  topup: {
    label: "Top-up",
    chip: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20",
    dot: "bg-violet-500",
    amount: "text-violet-600 dark:text-violet-400",
  },
};

export function statusTone(status: string | undefined): StatusTone {
  return STATUS_TONES[status ?? "completed"] ?? STATUS_TONES.completed;
}
