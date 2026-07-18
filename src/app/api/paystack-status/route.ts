import { NextResponse } from "next/server";
import { paystackStatus } from "@/lib/paystack";

/** GET /api/paystack-status — one-call diagnostic for the Paystack integration.
 * Probes the bank list AND the resolve endpoint separately, because Paystack
 * gates them independently: a live bank list can mask a blocked /bank/resolve. */
export async function GET() {
  return NextResponse.json(await paystackStatus());
}
