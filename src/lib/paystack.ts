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
    const banks = body.data
      .map((b) => ({ name: b.name, code: b.code, slug: b.slug }))
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

/** Resolve a NUBAN account number to the real account holder's name via
 * Paystack. Returns null when the account genuinely doesn't resolve (so the
 * caller can 404), throws on transport/config errors. */
export async function resolveAccount(accountNumber: string, bankCode: string): Promise<ResolveResult | null> {
  const key = paystackKey();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not configured");

  const url = `${PAYSTACK_BASE}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });

  // Paystack answers 422 for an account that doesn't resolve.
  if (res.status === 422 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Paystack /bank/resolve ${res.status}`);

  const body = (await res.json()) as PaystackEnvelope<{ account_number: string; account_name: string }>;
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
