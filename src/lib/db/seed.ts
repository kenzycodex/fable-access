// Seeds the database to mirror the frontend's synthetic world exactly, so the
// dashboard and demo bank open onto the same populated institution. Runnable
// both from prisma/seed.ts (node) and the /api/seed route (Next). Uses relative
// imports so Node's native TS type-stripping can execute it without a bundler.

import type { RiskAction } from "../fable/types";
import { DEMO_USER, INSTITUTION, SEED_INSTITUTION_FEED } from "../fable/seed";
import { prisma } from "../prisma";

/** The demo user's real account number (matches the demo bank's home card). */
export const DEMO_ACCOUNT_NUMBER = "9827341029";
export const DEMO_USER_EMAIL = "ada@meridian.ng";

const levelFor = (action: RiskAction): string =>
  action === "BLOCK" ? "HIGH" : action === "FLAG" ? "MEDIUM" : "LOW";

export interface SeedResult {
  institution: string;
  users: number;
  transactions: number;
}

/** Wipe and repopulate. Idempotent: safe to call repeatedly (e.g. a demo reset). */
export async function seedDatabase(): Promise<SeedResult> {
  // FK-safe delete order.
  await prisma.ghostContainer.deleteMany();
  await prisma.riskEvaluation.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.user.deleteMany();
  await prisma.institution.deleteMany();

  const institution = await prisma.institution.create({
    data: {
      slug: INSTITUTION.id,
      name: INSTITUTION.name,
      type: INSTITUTION.type,
      email: INSTITUTION.contactEmail,
    },
  });

  const demoUser = await prisma.user.create({
    data: {
      name: DEMO_USER.name,
      email: DEMO_USER_EMAIL,
      accountNumber: DEMO_ACCOUNT_NUMBER,
      balance: DEMO_USER.balance,
      institutionId: institution.id,
    },
  });

  // Mirror the frontend institution feed (many customers, mixed outcomes).
  for (const t of SEED_INSTITUTION_FEED) {
    await prisma.transaction.create({
      data: {
        amount: t.amount,
        currency: "NGN",
        direction: t.direction,
        channel: t.channel,
        narration: t.narration,
        customerName: t.customerName,
        recipientName: t.recipientName,
        recipientBank: t.recipientBank,
        recipientAccount: t.recipientAccount,
        status: t.status,
        live: false,
        createdAt: new Date(t.timestamp),
        institutionId: institution.id,
        userId: t.customerName === DEMO_USER.name ? demoUser.id : null,
        evaluation: {
          create: {
            riskScore: t.riskScore,
            riskLevel: levelFor(t.action),
            action: t.action,
            signals: JSON.stringify(t.signals),
            explanation: t.explanation,
            latencyMs: t.latencyMs,
          },
        },
      },
    });
  }

  const transactions = await prisma.transaction.count();
  return { institution: institution.name, users: 1, transactions };
}
