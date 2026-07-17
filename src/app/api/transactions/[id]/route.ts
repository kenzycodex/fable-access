// PATCH /api/transactions/[id] — finalize a held transfer's status after the
// user decides on the result screen (blocked / cancelled / completed).

import { NextResponse } from "next/server";
import { toTransaction, TXN_SELECT } from "@/lib/db/mappers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["completed", "blocked", "cancelled", "held", "released"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { status?: string };
  try {
    body = (await request.json()) as { status?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = body.status;
  if (!status || !ALLOWED.has(status)) {
    return NextResponse.json({ error: `status must be one of ${[...ALLOWED].join(", ")}` }, { status: 400 });
  }

  try {
    const updated = await prisma.transaction.update({
      where: { id },
      data: { status },
      select: TXN_SELECT,
    });
    return NextResponse.json({ transaction: toTransaction(updated) });
  } catch {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }
}
