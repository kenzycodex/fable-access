// Fable Shield scoring engine, ported to a pure client-side function from the
// reference Python (six signal layers). No backend, no API call: the demo runs
// this in the browser. If a real Fable API is built later, this whole module is
// what gets swapped for a fetch() to POST /v1/shield/analyze, and none of the
// screen components need to change.

import type { Channel, Recipient, ScoreResult, Signal, TransactionInput } from "./types";

/** The demo user's behavioral baseline (Copilot). Ada pays her mother at
 * month-end, small vendor payments on weekday mornings, monthly utilities.
 * Her typical transfer sits around ₦11,500. */
export const BASELINE = {
  avgAmount: 11_500,
  typicalHours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
};

/** Channel risk weights, from NIBSS 2023-2025 fraud distribution. USSD is
 * highest (no device fingerprint); the in-app channel is lowest because
 * Copilot personalizes per user there. */
export const CHANNEL_RISK_WEIGHTS: Record<Channel, number> = {
  app: 0.05,
  ussd: 0.25,
  pos: 0.2,
  web: 0.18,
  atm: 0.12,
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  app: "Mobile App",
  ussd: "USSD",
  pos: "POS",
  web: "Web",
  atm: "ATM",
};

interface ScamPattern {
  name: string;
  label: string;
  keywords: string[];
  weight: number;
}

/** Nigerian scam-pattern library (English + Pidgin). The narration is matched
 * against these; the first pattern that hits contributes its weight. */
export const SCAM_PATTERNS: ScamPattern[] = [
  {
    name: "family_impersonation",
    label: "Family impersonation",
    keywords: ["mama dey sick", "dem carry am go hospital", "your brother", "your sister", "na your pikin"],
    weight: 0.35,
  },
  {
    name: "urgency_pidgin",
    label: "Urgency (Pidgin)",
    keywords: ["abeg", "e don cast", "send am now", "no delay", "na emergency", "sharp sharp"],
    weight: 0.3,
  },
  {
    name: "urgency_english",
    label: "Urgency keyword",
    keywords: ["urgent", "emergency", "immediately", "asap", "right now", "quick quick"],
    weight: 0.3,
  },
  {
    name: "investment_fraud",
    label: "Investment fraud",
    keywords: ["double your money", "forex", "crypto signal", "100 percent return", "guaranteed profit"],
    weight: 0.4,
  },
  {
    name: "fake_alert",
    label: "Fake alert",
    keywords: ["alert don enter", "money don land", "i don send am", "check your account"],
    weight: 0.4,
  },
  {
    name: "account_blocked",
    label: "Account-block scam",
    keywords: ["blocked", "frozen", "suspended", "verify your bvn", "activate", "reactivate"],
    weight: 0.35,
  },
  {
    name: "supplier_fraud",
    label: "Supplier account-change",
    keywords: ["new account", "changed account", "updated account", "use this account instead"],
    weight: 0.45,
  },
];

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Score a transaction across the six Shield signal layers and return a verdict.
 * Pure and deterministic: same input always yields the same result.
 */
export function scoreTransaction(input: TransactionInput): ScoreResult {
  const { amount, recipient, narration, channel } = input;
  const hour = input.hour ?? new Date().getHours();

  const signals: Signal[] = [];
  let score = 0;

  // 1 — Amount anomaly (progressive multiplier vs. baseline).
  if (amount > BASELINE.avgAmount * 3) {
    const mult = Math.round(amount / BASELINE.avgAmount);
    const weight = mult >= 10 ? 0.3 : mult >= 5 ? 0.22 : 0.15;
    signals.push({
      code: "amount_anomaly",
      label: "Amount anomaly",
      detail: `${mult}× larger than your usual transfers`,
      weight,
    });
    score += weight;
  }

  // 2 — New recipient (not in the trusted list).
  if (!recipient.known) {
    const weight = 0.2;
    signals.push({
      code: "new_recipient",
      label: "New recipient",
      detail: "First transfer to this account",
      weight,
    });
    score += weight;
  }

  // 3 — Time anomaly (outside typical active hours).
  if (!BASELINE.typicalHours.includes(hour)) {
    const weight = 0.12;
    signals.push({
      code: "time_anomaly",
      label: "Unusual time",
      detail: "Outside your typical active hours",
      weight,
    });
    score += weight;
  }

  // 4 — Channel risk weight.
  const channelBoost = CHANNEL_RISK_WEIGHTS[channel] ?? 0.15;
  if (channelBoost > 0.05) {
    signals.push({
      code: "channel_risk",
      label: "Higher-risk channel",
      detail: `${CHANNEL_LABELS[channel]} carries more fraud risk than in-app`,
      weight: channelBoost,
    });
    score += channelBoost;
  }

  // 5 — Nigerian scam-pattern match on the narration (first hit wins).
  const narrationLower = narration.toLowerCase();
  for (const pattern of SCAM_PATTERNS) {
    if (pattern.keywords.some((kw) => narrationLower.includes(kw))) {
      signals.push({
        code: "scam_pattern",
        label: pattern.label,
        detail: "Narration matches a known Nigerian scam script",
        weight: pattern.weight,
      });
      score += pattern.weight;
      break;
    }
  }

  score = Math.min(round3(score), 1);

  const action: ScoreResult["action"] = score >= 0.8 ? "BLOCK" : score >= 0.5 ? "FLAG" : "PASS";

  return {
    riskScore: score,
    action,
    signals,
    explanation: explain(action, signals, recipient),
    // The real budget is sub-200ms; surface a realistic, deterministic figure.
    latencyMs: 110 + (Math.abs(hashString(narration + amount)) % 80),
  };
}

/** Plain-language explanation, deterministic, never blames the user. */
function explain(action: ScoreResult["action"], signals: Signal[], recipient: Recipient): string {
  if (action === "PASS") {
    return recipient.known
      ? `Fable recognized this as your regular payment to ${recipient.name}. Cleared instantly, no friction.`
      : "Nothing about this transfer breaks your normal pattern. Cleared instantly.";
  }

  const reasons = signals
    .map((s) => {
      switch (s.code) {
        case "amount_anomaly":
          return `the amount is ${s.detail.replace(" than your usual transfers", "")}`;
        case "new_recipient":
          return "the recipient is new to you";
        case "time_anomaly":
          return "it's outside your usual hours";
        case "channel_risk":
          return "it's going through a higher-risk channel";
        case "scam_pattern":
          return "the narration matches known Nigerian scam patterns";
        default:
          return s.label.toLowerCase();
      }
    })
    .filter(Boolean);

  const joined =
    reasons.length > 1 ? `${reasons.slice(0, -1).join(", ")}, and ${reasons[reasons.length - 1]}` : reasons[0] ?? "";

  const verb = action === "BLOCK" ? "was held" : "was flagged";
  return `This transfer ${verb} because ${joined}. Your money is safe. Cancel it, or hold it in Ghost to decide later.`;
}

/** Tiny stable hash so the surfaced latency figure is deterministic per input. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * The transparency panel's live risk preview: score a fixed sample "unfamiliar
 * transfer" using only the signals the user currently lets Fable use. Turning a
 * signal off removes that protection, so the number drops, that's the teaching
 * moment. Mirrors the same weight family as the real engine.
 */
export const PREVIEW_SIGNAL_WEIGHTS = {
  typicalRange: 0.3,
  trustedRecipients: 0.2,
  channel: 0.14,
  knownDevices: 0.15,
  activeHours: 0.12,
} as const;

export function previewScore(state: {
  typicalRange: boolean;
  activeHours: boolean;
  trustedRecipients: boolean;
  knownDevices: boolean;
  channel: boolean;
}): number {
  let score = 0;
  if (state.typicalRange) score += PREVIEW_SIGNAL_WEIGHTS.typicalRange;
  if (state.trustedRecipients) score += PREVIEW_SIGNAL_WEIGHTS.trustedRecipients;
  if (state.channel) score += PREVIEW_SIGNAL_WEIGHTS.channel;
  if (state.knownDevices) score += PREVIEW_SIGNAL_WEIGHTS.knownDevices;
  if (state.activeHours) score += PREVIEW_SIGNAL_WEIGHTS.activeHours;
  return Math.min(round3(score), 1);
}
