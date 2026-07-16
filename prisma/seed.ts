// Standalone DB seeder. Run with: node prisma/seed.ts
// (Node 24 strips TS types natively.) The actual logic lives in
// src/lib/db/seed.ts so the /api/seed route can reuse it.

import { seedDatabase } from "../src/lib/db/seed";
import { prisma } from "../src/lib/prisma";

seedDatabase()
  .then((r) => {
    console.log(`Seeded ${r.institution}: ${r.users} user, ${r.transactions} transactions.`);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
