// GET /api/transactions — the institution's full feed (newest first), joined
// with each transaction's Fable risk evaluation. Powers both the dashboard
// (all customers) and the demo bank's history (filtered client-side to the
// demo user). Optional ?action=PASS|FLAG|BLOCK and ?limit=.

import { NextResponse } from "next/server";
import { toTransaction, TXN_SELECT } from "@/lib/db/mappers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 200, 500);
  const action = searchParams.get("action");

  const where = action ? { evaluation: { action: action.toUpperCase() } } : {};

  const rows = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: TXN_SELECT,
  });

  return NextResponse.json({ transactions: rows.map(toTransaction), total: rows.length });
}
