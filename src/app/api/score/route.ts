// POST /api/score — the Fable risk engine, server-side.
// Scores an incoming transfer with the six-signal engine (reused from
// scoring.ts, the same logic the client falls back to), then persists the
// Transaction + RiskEvaluation to the database and returns the scored
// transaction in the frontend's shape. PASS commits immediately; FLAG/BLOCK
// land as "held" pending the user's decision on the result screen.

import { NextResponse } from "next/server";
import { toTransaction, TXN_SELECT } from "@/lib/db/mappers";
import { DEMO_ACCOUNT_NUMBER } from "@/lib/db/seed";
import { INSTITUTION } from "@/lib/fable/seed";
import { scoreTransaction } from "@/lib/fable/scoring";
import type { Channel, Recipient } from "@/lib/fable/types";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ScoreBody {
  amount: number;
  recipient: Recipient;
  narration?: string;
  channel: Channel;
  customerName?: string;
}

const levelFor = (action: string) => (action === "BLOCK" ? "HIGH" : action === "FLAG" ? "MEDIUM" : "LOW");

export async function POST(request: Request) {
  let body: ScoreBody;
  try {
    body = (await request.json()) as ScoreBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { amount, recipient, narration = "", channel } = body;
  if (!amount || amount <= 0 || !recipient?.accountNumber || !channel) {
    return NextResponse.json({ error: "amount, recipient, and channel are required" }, { status: 400 });
  }

  // Run the real scoring engine.
  const result = scoreTransaction({ amount, recipient, narration, channel });
  const status = result.action === "PASS" ? "completed" : "held";

  // Resolve the tenant + demo customer (seed-created). Falls back gracefully
  // if the DB hasn't been seeded yet.
  const institution = await prisma.institution.findUnique({ where: { slug: INSTITUTION.id } });
  if (!institution) {
    return NextResponse.json({ error: "Institution not seeded. POST /api/seed first." }, { status: 503 });
  }
  const demoUser = await prisma.user.findUnique({ where: { accountNumber: DEMO_ACCOUNT_NUMBER } });

  const created = await prisma.transaction.create({
    data: {
      amount,
      currency: "NGN",
      direction: "debit",
      channel,
      narration,
      customerName: body.customerName ?? demoUser?.name ?? "Demo Customer",
      recipientName: recipient.name,
      recipientBank: recipient.bank,
      recipientAccount: recipient.accountNumber,
      status,
      live: true,
      institutionId: institution.id,
      userId: demoUser?.id ?? null,
      evaluation: {
        create: {
          riskScore: result.riskScore,
          riskLevel: levelFor(result.action),
          action: result.action,
          signals: JSON.stringify(result.signals),
          explanation: result.explanation,
          latencyMs: result.latencyMs,
        },
      },
    },
    select: TXN_SELECT,
  });

  return NextResponse.json({ transaction: toTransaction(created) });
}
