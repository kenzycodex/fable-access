// Read-only derivations over the transaction feed, shared by the dashboard
// screens so every surface reports the same numbers.

import type { Channel, Transaction } from "./types";

export interface FeedSummary {
  total: number;
  passCount: number;
  flagCount: number;
  blockCount: number;
  /** Money kept out of fraudsters' hands (blocked + cancelled + held). */
  amountProtected: number;
  avgLatencyMs: number;
  fraudRate: number; // (flag + block) / total
}

const isProtected = (t: Transaction) =>
  t.action !== "PASS" && (t.status === "blocked" || t.status === "cancelled" || t.status === "held");

export function summarize(txns: Transaction[]): FeedSummary {
  const total = txns.length || 1;
  const passCount = txns.filter((t) => t.action === "PASS").length;
  const flagCount = txns.filter((t) => t.action === "FLAG").length;
  const blockCount = txns.filter((t) => t.action === "BLOCK").length;
  const amountProtected = txns.filter(isProtected).reduce((sum, t) => sum + t.amount, 0);
  const avgLatencyMs = Math.round(txns.reduce((sum, t) => sum + t.latencyMs, 0) / total);
  return {
    total: txns.length,
    passCount,
    flagCount,
    blockCount,
    amountProtected,
    avgLatencyMs,
    fraudRate: (flagCount + blockCount) / total,
  };
}

export interface ChannelStat {
  channel: Channel;
  count: number;
  risky: number; // flagged or blocked
}

export function channelBreakdown(txns: Transaction[]): ChannelStat[] {
  const channels: Channel[] = ["app", "ussd", "web", "pos", "atm"];
  return channels
    .map((channel) => {
      const rows = txns.filter((t) => t.channel === channel);
      return {
        channel,
        count: rows.length,
        risky: rows.filter((t) => t.action !== "PASS").length,
      };
    })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
}

export interface PatternStat {
  label: string;
  count: number;
}

/** Count how often each scam pattern (by signal label) triggered. */
export function scamPatternBreakdown(txns: Transaction[]): PatternStat[] {
  const counts = new Map<string, number>();
  for (const t of txns) {
    for (const s of t.signals) {
      if (s.code === "scam_pattern") {
        counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** Count how often each signal type fired across the feed. */
export function signalBreakdown(txns: Transaction[]): PatternStat[] {
  const labelByCode: Record<string, string> = {
    amount_anomaly: "Amount anomaly",
    new_recipient: "New recipient",
    time_anomaly: "Unusual time",
    channel_risk: "Higher-risk channel",
    scam_pattern: "Scam-script match",
  };
  const counts = new Map<string, number>();
  for (const t of txns) {
    for (const s of t.signals) {
      const label = labelByCode[s.code] ?? s.label;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** Alerts = anything Shield flagged or blocked, newest first. */
export function alerts(txns: Transaction[]): Transaction[] {
  return txns.filter((t) => t.action !== "PASS").sort((a, b) => b.timestamp - a.timestamp);
}
