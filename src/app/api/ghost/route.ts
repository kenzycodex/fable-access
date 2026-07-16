// POST /api/ghost — route an overridden high-risk transfer into a Ghost
// cooling-window container. The window scales with risk (higher risk =>
// longer window), and the underlying transaction is marked "held".

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Risk-based cooling window in seconds (mirrors the FastAPI reference). */
function coolingSeconds(riskScore: number): number {
  if (riskScore >= 0.9) return 30 * 60;
  if (riskScore >= 0.7) return 15 * 60;
  return 5 * 60;
}

export async function POST(request: Request) {
  let body: { transactionId?: string };
  try {
    body = (await request.json()) as { transactionId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.transactionId) {
    return NextResponse.json({ error: "transactionId is required" }, { status: 400 });
  }

  const txn = await prisma.transaction.findUnique({
    where: { id: body.transactionId },
    select: { id: true, amount: true, evaluation: { select: { riskScore: true } } },
  });
  if (!txn) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const windowSeconds = coolingSeconds(txn.evaluation?.riskScore ?? 0.85);
  const expiresAt = new Date(Date.now() + windowSeconds * 1000);

  const ghost = await prisma.ghostContainer.upsert({
    where: { transactionId: txn.id },
    update: { status: "held", windowSeconds, expiresAt, resolvedAt: null },
    create: { transactionId: txn.id, amount: txn.amount, status: "held", windowSeconds, expiresAt },
  });
  await prisma.transaction.update({ where: { id: txn.id }, data: { status: "held" } });

  return NextResponse.json({
    ghost: {
      id: ghost.id,
      transactionId: ghost.transactionId,
      amount: ghost.amount,
      windowSeconds: ghost.windowSeconds,
      expiresAt: ghost.expiresAt.getTime(),
      status: ghost.status,
    },
  });
}
