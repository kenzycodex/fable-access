import { NextResponse } from "next/server";
import { DEMO_CUSTOMERS, DEMO_PAYEES, MAX_AMOUNT } from "@/lib/forge/demo-data";

// What the demo page may ask of Fable, and nothing else.
//
// The page is public (anything at the team's address is reachable by anyone
// with the link), and the API wants the institution's key, which must never
// reach a browser. So the key lives here, on the server, and this route
// forwards only a short list of actions, only for the demo's own customers,
// accounts and payees, and slowly: the bank allows 60 requests a minute for
// the whole team.

const API = (process.env.FABLE_INTERNAL_API_URL || process.env.NEXT_PUBLIC_FABLE_API_URL || "http://localhost:8000").replace(/\/+$/, "");
const KEY = process.env.FORGE_DEMO_API_KEY || "";
const TXN = /^txn_[a-f0-9]{12}$/;

const hits = new Map<string, number[]>();
function allowed(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 40) return false;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear();
  return true;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: "refused", message }, { status });
}

type Body = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

function customerOf(ref: string) {
  return DEMO_CUSTOMERS.find((c) => c.ref === ref);
}
function payeeOf(account: string) {
  return DEMO_PAYEES.find((p) => p.account === account);
}

async function forward(method: "GET" | "POST", path: string, body?: Body) {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return new NextResponse(text, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "unreachable", message: "Fable could not be reached." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!KEY) return bad("The demo is not configured yet.", 503);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allowed(ip)) return bad("Too many requests. Wait a moment.", 429);

  const raw = await request.text();
  if (raw.length > 4000) return bad("Request too large.", 413);
  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return bad("Body is not JSON.");
  }

  const user = customerOf(str(body.user_id));
  if (!user) return bad("Unknown demo customer.");
  const action = str(body.action);

  if (action === "enquiry") {
    const payee = payeeOf(str(body.account_number));
    if (!payee) return bad("Unknown demo payee.");
    return forward("POST", "/v1/forge/enquiry", {
      user_id: user.ref, account_number: payee.account, bank_code: payee.bankCode, intra: payee.intra,
    });
  }

  if (action === "transfer") {
    const payee = payeeOf(str(body.destination_account));
    const amount = Number(body.amount);
    if (!payee) return bad("Unknown demo payee.");
    if (str(body.source_account) !== user.account) return bad("That account does not belong to this customer.");
    if (!(amount > 0 && amount <= MAX_AMOUNT)) return bad("Amount is outside the demo's range.");
    return forward("POST", "/v1/forge/transfer", {
      user_id: user.ref,
      source_account: user.account,
      destination_account: payee.account,
      destination_bank_code: payee.bankCode,
      intra: payee.intra,
      name_enquiry_ref: str(body.name_enquiry_ref),
      recipient_name: payee.name,
      amount: Math.round(amount * 100) / 100,
      narration: "Fable demo",
      client_reference: str(body.client_reference).slice(0, 80),
    });
  }

  const id = str(body.id);
  if (!TXN.test(id)) return bad("Unknown transfer.");
  if (action === "status") return forward("GET", `/v1/forge/transfers/${id}?user_id=${encodeURIComponent(user.ref)}`);
  if (action === "cancel") return forward("POST", `/v1/forge/transfers/${id}/cancel`, { user_id: user.ref });
  if (action === "pin") {
    return forward("POST", "/v1/stepup/pin/verify", { user_id: user.ref, pin: str(body.pin).slice(0, 12), purpose: "transfer", reference: id });
  }
  if (action === "confirm") {
    return forward("POST", `/v1/forge/transfers/${id}/confirm`, { user_id: user.ref, stepup_token: str(body.stepup_token) });
  }
  return bad("Unknown action.");
}
