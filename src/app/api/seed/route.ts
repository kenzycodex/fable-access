// POST /api/seed — (re)populate the database with the demo institution, the
// demo user, and the historical transaction feed. Idempotent; doubles as a
// "reset demo" action. GET reports whether the DB is already seeded.

import { NextResponse } from "next/server";
import { seedDatabase } from "@/lib/db/seed";
import { INSTITUTION } from "@/lib/fable/seed";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const institution = await prisma.institution.findUnique({ where: { slug: INSTITUTION.id } });
  const transactions = await prisma.transaction.count();
  return NextResponse.json({ seeded: Boolean(institution) && transactions > 0, transactions });
}

export async function POST() {
  try {
    const result = await seedDatabase();
    return NextResponse.json({ status: "seeded", ...result });
  } catch (error) {
    return NextResponse.json(
      { error: "Seed failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
