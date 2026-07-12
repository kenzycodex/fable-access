// Maps Prisma rows to the frontend Transaction shape the UI already renders,
// so API routes return exactly what the store/components expect.

import type { Channel, RiskAction, Signal, Transaction, TransactionStatus } from "../fable/types";

/** The DB fields we select for a transaction (with its evaluation joined). */
export interface TxnRow {
  id: string;
  amount: number;
  direction: string;
  channel: string;
  narration: string;
  status: string;
  live: boolean;
  createdAt: Date;
  customerName: string;
  recipientName: string;
  recipientBank: string;
  recipientAccount: string;
  evaluation: {
    riskScore: number;
    action: string;
    signals: string;
    explanation: string;
    latencyMs: number;
  } | null;
}

function parseSignals(json: string): Signal[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Signal[]) : [];
  } catch {
    return [];
  }
}

export function toTransaction(row: TxnRow): Transaction {
  const ev = row.evaluation;
  return {
    id: row.id,
    timestamp: row.createdAt.getTime(),
    amount: row.amount,
    direction: row.direction === "credit" ? "credit" : "debit",
    channel: row.channel as Channel,
    narration: row.narration,
    status: row.status as TransactionStatus,
    riskScore: ev?.riskScore ?? 0,
    action: (ev?.action as RiskAction) ?? "PASS",
    signals: ev ? parseSignals(ev.signals) : [],
    explanation: ev?.explanation ?? "",
    latencyMs: ev?.latencyMs ?? 0,
    recipientName: row.recipientName,
    recipientBank: row.recipientBank,
    recipientAccount: row.recipientAccount,
    customerName: row.customerName,
    live: row.live,
    remote: true,
  };
}

/** The select clause that produces a TxnRow. */
export const TXN_SELECT = {
  id: true,
  amount: true,
  direction: true,
  channel: true,
  narration: true,
  status: true,
  live: true,
  createdAt: true,
  customerName: true,
  recipientName: true,
  recipientBank: true,
  recipientAccount: true,
  evaluation: {
    select: { riskScore: true, action: true, signals: true, explanation: true, latencyMs: true },
  },
} as const;
