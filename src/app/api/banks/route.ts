import { NextResponse } from "next/server";
import { bridgeEnabled, SANDBOX_BANKS } from "@/lib/forge/banks";
import { getBankList } from "@/lib/paystack";

/** GET /api/banks — the real Paystack Nigerian bank list (cached server-side),
 * or the built-in fallback list (real NUBAN codes) when no key is set. */
export async function GET() {
  // Connected to the Xtradot Bank sandbox: only its banks, with its NIP codes.
  if (bridgeEnabled()) return NextResponse.json({ banks: SANDBOX_BANKS, source: "xtradot" });
  const { banks, source } = await getBankList();
  return NextResponse.json({ banks, source });
}
