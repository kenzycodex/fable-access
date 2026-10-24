import { NextResponse } from "next/server";
import { getBankList } from "@/lib/paystack";

/** GET /api/banks — the real Paystack Nigerian bank list (cached server-side),
 * or the built-in fallback list (real NUBAN codes) when no key is set. */
export async function GET() {
  const { banks, source } = await getBankList();
  return NextResponse.json({ banks, source });
}
