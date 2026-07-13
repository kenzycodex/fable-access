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
