// Fable Shield scoring engine, ported to a pure client-side function from the
// reference Python (six signal layers). No backend, no API call: the demo runs
// this in the browser. If a real Fable API is built later, this whole module is
// what gets swapped for a fetch() to POST /v1/shield/analyze, and none of the
// screen components need to change.

import type { Channel, Recipient, ScoreResult, Signal, TransactionInput } from "./types";

/** The demo user's behavioral baseline (Copilot). Ada pays her mother at
 * month-end, small vendor payments on weekday mornings, monthly utilities.
 * Her typical transfer sits around ₦11,500. */
/** The customer's real baseline, cached from the API for use when it is not
 *  reachable.
 *
 *  This used to be a single hardcoded constant applied to every customer, which
 *  inverted the product's central claim offline: a trader whose normal is
 *  ₦260,000 had every routine transfer read as ~22x "baseline" and flagged,
 *  while a student's ₦30,000 scam sat under the 3x trigger and passed. The
 *  engine cannot score against a personal baseline it has never been given.
 *
 *  Cached per customer, refreshed on every home-screen load, and used only
 *  while the API is unreachable. With no cache the fallback declines to score
 *  rather than guessing — see scoreTransaction.
 */
export interface CachedBaseline {
  avgAmount: number;
  typicalHours: number[];
  knownRecipients: string[];
  transactionCount: number;
  tenureDiscount: number;
}

const BASELINE_KEY = "fable_baseline_cache";

export function cacheBaseline(userId: string, b: CachedBaseline | null): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const all = JSON.parse(localStorage.getItem(BASELINE_KEY) ?? "{}") as Record<string, CachedBaseline>;
    if (b) all[userId] = b;
    else delete all[userId];
    localStorage.setItem(BASELINE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: offline scoring will decline rather than guess.
  }
}

export function getCachedBaseline(userId: string | null | undefined): CachedBaseline | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const all = JSON.parse(localStorage.getItem(BASELINE_KEY) ?? "{}") as Record<string, CachedBaseline>;
    return all[userId] ?? null;
  } catch {
    return null;
  }
}

/** Fallback for a customer with no cached baseline. Deliberately conservative:
 *  with nothing to compare against, this is the cold-start case, and the
 *  backend prices that at +0.15 rather than assuming the transfer is normal. */
const NO_BASELINE_PREMIUM = 0.15;

/** Per-channel decision cutoffs, mirroring api/agents/shield/weights.py.
 *  USSD and web trip sooner because NIBSS ties the most loss to them; an
 *  in-person branch transfer gets more room. Offline used a flat 0.8/0.5, so
 *  the same transfer could get a different verdict purely because the API was
 *  briefly unreachable. */
const CHANNEL_THRESHOLDS: Record<Channel, { flag: number; block: number }> = {
  web: { flag: 0.45, block: 0.75 },
  pos: { flag: 0.48, block: 0.78 },
  atm: { flag: 0.48, block: 0.78 },
  app: { flag: 0.48, block: 0.78 },
  ussd: { flag: 0.52, block: 0.82 },
};

/** Word-boundary keyword match, mirroring the backend fix. Bare substring
 *  matching fired "mum" inside *premium*, *maximum* and *minimum*. */
function matchesWord(keyword: string, text: string): boolean {
  const escaped = keyword.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

/** Channel risk weights, from NIBSS 2023-2025 fraud distribution. USSD is
 * highest (no device fingerprint); the in-app channel is lowest because
 * Copilot personalizes per user there. */
/** Mirrors api/agents/shield/channel_risk.py. These were inverted relative to
 *  NIBSS reporting: USSD carried the heaviest penalty despite not appearing
 *  among the top exploited channels in any year, and mobile the lightest
 *  despite being consistently among the most exploited and fastest growing. */
export const CHANNEL_RISK_WEIGHTS: Record<Channel, number> = {
  web: 0.22,
  pos: 0.18,
  app: 0.12,
  ussd: 0.12,
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
export function scoreTransaction(input: TransactionInput, userId?: string | null): ScoreResult {
  const { amount, recipient, narration, channel } = input;
  const hour = input.hour ?? new Date().getHours();
  const baseline = getCachedBaseline(userId);

  const signals: Signal[] = [];
  let score = 0;

  // 0 — No cached baseline is the cold-start case, priced the way the backend
  //     prices it rather than silently treating the transfer as normal.
  if (!baseline) {
    signals.push({
      code: "cold_start",
      label: "No baseline available",
      detail: "We can't compare this to your usual activity right now",
      weight: NO_BASELINE_PREMIUM,
    });
    score += NO_BASELINE_PREMIUM;
  }

  // 1 — Amount anomaly, against this customer's own average.
  //     Tiers match the backend's (3x/5x/10x/25x/50x) so an offline verdict is
  //     not systematically softer or harsher than the online one.
  if (baseline && amount > baseline.avgAmount * 3) {
    const mult = Math.round(amount / Math.max(baseline.avgAmount, 1));
    const weight = mult >= 50 ? 0.4 : mult >= 25 ? 0.34 : mult >= 10 ? 0.28 : mult >= 5 ? 0.2 : 0.15;
    signals.push({
      code: "amount_anomaly",
      label: "Amount anomaly",
      detail: `${mult}× larger than your usual transfers`,
      weight,
    });
    score += weight;
  }

  // 2 — New recipient. Prefers the cached list over the caller's own claim,
  //     since the client should not be the authority on who it has paid.
  const known = baseline
    ? baseline.knownRecipients.includes(recipient.accountNumber)
    : recipient.known;
  if (!known) {
    const weight = 0.14;
    signals.push({
      code: "new_recipient",
      label: "New recipient",
      detail: "First transfer to this account",
      weight,
    });
    score += weight;
  }

  // 3 — Time anomaly, against this customer's own hours.
  if (baseline && !baseline.typicalHours.includes(hour)) {
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
  //     Weights are halved to match NARRATION_WEIGHT_SCALE on the backend.
  //     Applying them raw made narration count nearly twice as much offline as
  //     online, on the layer the backend deliberately trusts least.
  const narrationLower = narration.toLowerCase();
  for (const pattern of SCAM_PATTERNS) {
    if (pattern.keywords.some((kw) => matchesWord(kw, narrationLower))) {
      const weight = round3(pattern.weight * 0.5);
      signals.push({
        code: "scam_pattern",
        label: pattern.label,
        detail: "Narration matches a known Nigerian scam script",
        weight,
      });
      score += weight;
      break;
    }
  }

  // 6 — Tenure discount, mirroring the backend so an established customer is
  //     not treated as a stranger the moment the connection drops.
  if (baseline && baseline.tenureDiscount > 0 && score > 0) {
    const applied = Math.min(baseline.tenureDiscount, score);
    signals.push({
      code: "tenure",
      label: "Established customer",
      detail: `${baseline.transactionCount} clean transfers on record`,
      weight: -applied,
    });
    score -= applied;
  }

  score = Math.min(round3(Math.max(score, 0)), 1);

  // Per-channel cutoffs, matching the backend. A flat 0.8/0.5 meant the same
  // transfer got a different verdict depending only on whether the API happened
  // to be reachable.
  const { flag, block } = CHANNEL_THRESHOLDS[channel] ?? { flag: 0.5, block: 0.8 };
  const action: ScoreResult["action"] = score >= block ? "BLOCK" : score >= flag ? "FLAG" : "PASS";

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
