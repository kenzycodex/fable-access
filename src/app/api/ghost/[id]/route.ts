// PATCH /api/ghost/[id] — resolve a Ghost container. { action: "cancel" }
// returns the money (transaction -> cancelled); { action: "confirm" } releases
// the transfer (transaction -> released).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "cancel" && action !== "confirm") {
    return NextResponse.json({ error: "action must be 'cancel' or 'confirm'" }, { status: 400 });
  }

  const ghost = await prisma.ghostContainer.findUnique({ where: { id } });
  if (!ghost) return NextResponse.json({ error: "Ghost container not found" }, { status: 404 });

  const ghostStatus = action === "cancel" ? "cancelled" : "released";
  const txnStatus = action === "cancel" ? "cancelled" : "released";

  await prisma.ghostContainer.update({
    where: { id },
    data: { status: ghostStatus, resolvedAt: new Date() },
  });
  await prisma.transaction.update({ where: { id: ghost.transactionId }, data: { status: txnStatus } });

  return NextResponse.json({ ghostId: id, status: ghostStatus });
}
