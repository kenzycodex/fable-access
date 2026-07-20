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
  // Only rows with a measured decision time count. Including unmeasured ones
  // as zero would report a latency far better than anything actually observed.
  const measured = txns.filter((t) => t.latencyMs > 0);
  const avgLatencyMs = measured.length
    ? Math.round(measured.reduce((sum, t) => sum + t.latencyMs, 0) / measured.length)
    : 0;
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

// ---------------------------------------------------------------------------
// Customer-level rollups for the demo bank's home screen.
//
// These were hardcoded literals. They are now derived from the customer's real
// transaction feed, which matters beyond cosmetics: balance, income, spend and
// category mix are exactly the datapoints Copilot builds a baseline from, so
// showing invented numbers next to a real risk engine was misleading.
// ---------------------------------------------------------------------------

/** Coarse spend categories inferred from who was paid and what for. */
const CATEGORY_RULES: { label: string; test: RegExp }[] = [
  { label: "🍔 Food & Dining", test: /food|vendor|biggs|restaurant|eat|lunch|shoprite|grocer/i },
  { label: "🚗 Transport", test: /transport|fuel|uber|bolt|haulage|logistics|petrol/i },
  { label: "⚡ Utilities", test: /nepa|light|electric|power|dstv|water|utility|bill/i },
  { label: "📱 Airtime & Data", test: /airtime|data|mtn|glo|airtel|9mobile|recharge/i },
  { label: "🏠 Rent & Housing", test: /rent|landlord|shop_rent|accommodation|service charge/i },
  { label: "🛍️ Shopping", test: /jumia|konga|slot|shopping|store|order|laptop/i },
];

function categorize(txn: Transaction): string {
  const haystack = `${txn.recipientName} ${txn.narration ?? ""}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(haystack)) return rule.label;
  }
  return "💸 Transfers";
}

export interface CustomerSummary {
  balance: number;
  income: number;
  spent: number;
  spentPctOfIncome: number;
  incomeDeltaPct: number | null;
  categories: { label: string; amount: number; pct: number }[];
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Everything the home screen shows, computed from one customer's feed.
 * `openingBalance` is the customer's starting float; settled debits reduce it
 * and credits raise it, so a transfer visibly moves the balance.
 */
export function summarizeCustomer(txns: Transaction[], openingBalance: number): CustomerSummary {
  const now = Date.now();
  const thisMonth = txns.filter((t) => now - t.timestamp <= MONTH_MS);
  const lastMonth = txns.filter((t) => now - t.timestamp > MONTH_MS && now - t.timestamp <= 2 * MONTH_MS);

  const sum = (list: Transaction[], dir: "credit" | "debit") =>
    list.filter((t) => t.direction === dir).reduce((acc, t) => acc + t.amount, 0);

  const income = sum(thisMonth, "credit");
  const spent = sum(thisMonth, "debit");

  // The stated balance already reflects the customer's history, exactly as a
  // real bank statement does, so only transfers made in this session move it.
  // Replaying 90 days of seeded debits against it drove balances deeply
  // negative — a student with a ₦63k balance and ₦780k of history showed
  // -₦717k.
  //
  // Held, cancelled and blocked transfers deliberately don't debit: that is
  // precisely the money Ghost keeps recoverable.
  const liveSettled = txns.filter(
    (t) => t.live && (t.status === "completed" || t.status === "released"),
  );
  const balance = Math.max(
    0,
    openingBalance + sum(liveSettled, "credit") - sum(liveSettled, "debit"),
  );

  const lastMonthIncome = sum(lastMonth, "credit");
  const incomeDeltaPct =
    lastMonthIncome > 0 ? Math.round(((income - lastMonthIncome) / lastMonthIncome) * 100) : null;

  const byCategory = new Map<string, number>();
  for (const t of thisMonth) {
    if (t.direction !== "debit") continue;
    const label = categorize(t);
    byCategory.set(label, (byCategory.get(label) ?? 0) + t.amount);
  }
  const largest = Math.max(...byCategory.values(), 0);
  const categories = [...byCategory.entries()]
    .map(([label, amount]) => ({ label, amount, pct: largest ? Math.round((amount / largest) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4);

  return {
    balance,
    income,
    spent,
    spentPctOfIncome: income > 0 ? Math.round((spent / income) * 100) : 0,
    incomeDeltaPct,
    categories,
  };
}
