// Server-only Paystack client for real NUBAN account resolution and the real
// Nigerian bank list. Used by the /api/banks and /api/resolve-account route
// handlers. Never import this from client components — the secret key lives
// here.
//
// With PAYSTACK_SECRET_KEY set (free test key, sk_test_...), both endpoints
// hit the live Paystack API. Without it, callers fall back to the built-in
// bank list below (real NUBAN codes) and a deterministic name generator, so
// the demo never breaks.

const PAYSTACK_BASE = "https://api.paystack.co";
const BANK_LIST_TTL_MS = 12 * 60 * 60 * 1000; // the bank list rarely changes

export interface Bank {
  name: string;
  code: string;
  slug: string;
}

/** Real NUBAN institution codes — used when no Paystack key is configured so
 * the dropdown still carries codes a real switch would accept. */
export const FALLBACK_BANKS: Bank[] = [
  { name: "Access Bank", code: "044", slug: "access-bank" },
  { name: "Citibank Nigeria", code: "023", slug: "citibank-nigeria" },
  { name: "Ecobank Nigeria", code: "050", slug: "ecobank-nigeria" },
  { name: "Fidelity Bank", code: "070", slug: "fidelity-bank" },
  { name: "First Bank of Nigeria", code: "011", slug: "first-bank-of-nigeria" },
  { name: "First City Monument Bank", code: "214", slug: "fcmb" },
  { name: "Globus Bank", code: "00103", slug: "globus-bank" },
  { name: "Guaranty Trust Bank", code: "058", slug: "gtbank" },
  { name: "Jaiz Bank", code: "301", slug: "jaiz-bank" },
  { name: "Keystone Bank", code: "082", slug: "keystone-bank" },
  { name: "Kuda Microfinance Bank", code: "50211", slug: "kuda-bank" },
  { name: "Moniepoint MFB", code: "50515", slug: "moniepoint-mfb" },
  { name: "OPay Digital Services", code: "999992", slug: "opay" },
  { name: "PalmPay", code: "999991", slug: "palmpay" },
  { name: "Polaris Bank", code: "076", slug: "polaris-bank" },
  { name: "Providus Bank", code: "101", slug: "providus-bank" },
  { name: "Stanbic IBTC Bank", code: "221", slug: "stanbic-ibtc-bank" },
  { name: "Sterling Bank", code: "232", slug: "sterling-bank" },
  { name: "Union Bank of Nigeria", code: "032", slug: "union-bank" },
  { name: "United Bank For Africa", code: "033", slug: "uba" },
  { name: "Unity Bank", code: "215", slug: "unity-bank" },
  { name: "Wema Bank", code: "035", slug: "wema-bank" },
  { name: "Zenith Bank", code: "057", slug: "zenith-bank" },
];

export function paystackKey(): string {
  return (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
}

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

let bankCache: { banks: Bank[]; fetchedAt: number } | null = null;

/** The real Paystack bank list (cached in memory), or the fallback list when
 * no key is set or the fetch fails. */
export async function getBankList(): Promise<{ banks: Bank[]; source: "paystack" | "fallback" }> {
  const key = paystackKey();
  if (!key) return { banks: FALLBACK_BANKS, source: "fallback" };

  if (bankCache && Date.now() - bankCache.fetchedAt < BANK_LIST_TTL_MS) {
    return { banks: bankCache.banks, source: "paystack" };
  }

  try {
    const res = await fetch(`${PAYSTACK_BASE}/bank?country=nigeria&perPage=100`, {
      headers: { Authorization: `Bearer ${key}` },
      // Route handlers aren't cached by default, but be explicit: we manage
      // our own TTL above.
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Paystack /bank ${res.status}`);
    const body = (await res.json()) as PaystackEnvelope<{ name: string; code: string; slug: string }[]>;
    
    // Deduplicate by bank code to prevent React duplicate key errors in the UI
    const uniqueBanks = new Map<string, Bank>();
    for (const b of body.data) {
      if (!uniqueBanks.has(b.code)) {
        uniqueBanks.set(b.code, { name: b.name, code: b.code, slug: b.slug });
      }
    }
    
    const banks = Array.from(uniqueBanks.values())
      .sort((a, b) => a.name.localeCompare(b.name));
    
    bankCache = { banks, fetchedAt: Date.now() };
    return { banks, source: "paystack" };
  } catch {
    return { banks: FALLBACK_BANKS, source: "fallback" };
  }
}

export interface ResolveResult {
  accountNumber: string;
  accountName: string;
  bankCode: string;
  bankName: string;
  source: "paystack" | "simulated";
}

/** Why a Paystack call could not be used. `ip_blocked` is the one that bites
 * in practice: Paystack enforces its IP allowlist per endpoint, so /bank can
 * succeed while /bank/resolve is rejected, which makes a broken integration
 * look healthy. */
export type PaystackFailure = "no_key" | "ip_blocked" | "unauthorized" | "rate_limited" | "transport";

export class PaystackError extends Error {
  constructor(readonly reason: PaystackFailure, message: string) {
    super(message);
    this.name = "PaystackError";
  }
}

function classifyFailure(status: number, message: string): PaystackFailure {
  if (/ip address is not allowed/i.test(message)) return "ip_blocked";
  // Test keys allow only a handful of live resolutions per day. Reporting
  // this as a generic transport error made a working integration look broken.
  if (status === 429 || /daily limit/i.test(message)) return "rate_limited";
  if (status === 401 || status === 403) return "unauthorized";
  return "transport";
}

/** Resolve a NUBAN account number to the real account holder's name via
 * Paystack. Returns null when the account genuinely doesn't resolve (so the
 * caller can 404), throws PaystackError on config/transport failures. */
export async function resolveAccount(accountNumber: string, bankCode: string): Promise<ResolveResult | null> {
  const key = paystackKey();
  if (!key) throw new PaystackError("no_key", "PAYSTACK_SECRET_KEY not configured");

  const url = `${PAYSTACK_BASE}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });

  // Paystack answers 422 for an account that doesn't resolve. But it also
  // returns non-2xx for IP rejection, so read the body before deciding.
  const raw = await res.text();
  let parsed: { status?: boolean; message?: string; data?: { account_number: string; account_name: string } } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PaystackError("transport", `Paystack /bank/resolve ${res.status}: unparseable response`);
  }

  const message = parsed.message ?? "";
  if (/ip address is not allowed/i.test(message)) {
    throw new PaystackError("ip_blocked", message);
  }
  if (res.status === 422 || res.status === 404) return null;
  if (!res.ok) throw new PaystackError(classifyFailure(res.status, message), `Paystack /bank/resolve ${res.status}: ${message}`);

  const body = parsed as PaystackEnvelope<{ account_number: string; account_name: string }>;
  if (!body.status || !body.data?.account_name) return null;

  const { banks } = await getBankList();
  const bank = banks.find((b) => b.code === bankCode);
  return {
    accountNumber: body.data.account_number,
    accountName: body.data.account_name,
    bankCode,
    bankName: bank?.name ?? bankCode,
    source: "paystack",
  };
}

export interface PaystackStatus {
  keyConfigured: boolean;
  bankList: { ok: boolean; count: number; detail: string };
  /** The endpoint that actually matters, and the one the allowlist blocks. */
  resolve: { ok: boolean; reason?: PaystackFailure; detail: string };
  publicIp: string | null;
  advice: string | null;
}

/** Probe both Paystack endpoints so a half-working integration is visible.
 * /bank succeeding tells you nothing about /bank/resolve — they are gated
 * separately, which is exactly how a blocked IP hides behind a live bank list. */
export async function paystackStatus(): Promise<PaystackStatus> {
  const key = paystackKey();
  if (!key) {
    return {
      keyConfigured: false,
      bankList: { ok: false, count: 0, detail: "No key configured" },
      resolve: { ok: false, reason: "no_key", detail: "No key configured" },
      publicIp: null,
      advice: "Set PAYSTACK_SECRET_KEY in .env.local, then restart the dev server.",
    };
  }

  const publicIp = await fetch("https://api.ipify.org?format=json", { cache: "no-store" })
    .then((r) => r.json())
    .then((j: { ip: string }) => j.ip)
    .catch(() => null);

  const list = await getBankList();

  // Paystack's own documented test account, so a failure here is the
  // integration, never a bad account number.
  let resolve: PaystackStatus["resolve"];
  try {
    const r = await resolveAccount("0000000000", "058");
    resolve = { ok: true, detail: r ? "Resolved" : "Reachable (test account not found, which is expected)" };
  } catch (err) {
    const reason = err instanceof PaystackError ? err.reason : "transport";
    resolve = { ok: false, reason, detail: err instanceof Error ? err.message : String(err) };
  }

  let advice: string | null = null;
  if (resolve.reason === "ip_blocked") {
    advice =
      `Paystack is rejecting this machine's IP (${publicIp ?? "unknown"}) on /bank/resolve. ` +
      "Dynamic ISP addresses rotate, so pinning one IP will break again. In the Paystack " +
      "dashboard go to Settings -> API Keys & Webhooks and CLEAR the Test IP allowlist box " +
      "entirely (empty = allow all), then Save.";
  } else if (resolve.reason === "unauthorized") {
    advice = "Paystack rejected the key itself. Confirm you copied the Test Secret Key (sk_test_...).";
  }

  return {
    keyConfigured: true,
    bankList: {
      ok: list.source === "paystack",
      count: list.banks.length,
      detail: list.source === "paystack" ? "Live from Paystack" : "Using built-in fallback list",
    },
    resolve,
    publicIp,
    advice,
  };
}

/** Look a bank up by code or (legacy) by name, against whichever list is active. */
export async function findBank(codeOrName: string): Promise<Bank | undefined> {
  const { banks } = await getBankList();
  const needle = codeOrName.trim().toLowerCase();
  return (
    banks.find((b) => b.code === codeOrName) ??
    banks.find((b) => b.name.toLowerCase() === needle) ??
    banks.find((b) => b.name.toLowerCase().includes(needle))
  );
}
