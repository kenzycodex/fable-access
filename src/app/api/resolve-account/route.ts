import { NextResponse } from "next/server";
import { findBank, paystackKey, PaystackError, resolveAccount, type PaystackFailure } from "@/lib/paystack";
import { guardLookup } from "@/lib/routeGuard";
import { API_BASE } from "@/lib/fable/base";
import { bridgeEnabled, SANDBOX_BANKS, XTRADOT_CODE } from "@/lib/forge/banks";

// With PAYSTACK_SECRET_KEY set (.env.local), this resolves real account
// holders via the Paystack NUBAN lookup (free on test keys). Without a key it
// falls back to the deterministic name generator below, so the demo never
// breaks — the response's `source` field says which path answered.

const FIRST_NAMES = [
  "Bello", "Chioma", "Emeka", "Adeola", "Oluwaseun", "Fatima", "Aisha", "Chinedu", "Ngozi", "Ibrahim",
  "Tunde", "Zainab", "Abubakar", "Funmilayo", "Nnamdi", "Kemi", "Uche", "Yusuf", "Olamide", "Halima",
  "Samuel", "Grace", "David", "Mary", "Emmanuel", "Blessing", "Daniel", "Joy", "Michael", "Esther",
  "Onyeka", "Folake", "Chidi", "Amaka", "Mustapha", "Khadija", "Babajide", "Tolulope", "Chukwudi", "Nneka",
  "Segun", "Bose", "Kelechi", "Chika", "Suleiman", "Habiba", "Olumide", "Titilayo", "Obinna", "Ogechi"
];

const LAST_NAMES = [
  "Mukhtar", "Nnamdi", "Okafor", "Musa", "Adeyemi", "Mohammed", "Ibrahim", "Okoro", "Abubakar", "Ogunleye",
  "Ojo", "Aliyu", "Umar", "Adebayo", "Eze", "Lawal", "Olawale", "Sani", "Balogun", "Osagie",
  "Okeke", "Babatunde", "Hassan", "Kalu", "Gbadamosi", "Ani", "Danjuma", "Agboola", "Nwosu", "Adekunle",
  "Idris", "Akinyemi", "Chukwu", "Okonkwo", "Yakubu", "Adesina", "Udo", "Obi", "Garba", "Oladipo",
  "Afolabi", "Salawu", "Igbokwe", "Abiola", "Oluwasegun", "Adebisi", "Fashola", "Oyekan", "Oni", "Nwachukwu"
];

/** Deterministically hash a 10-digit account number to pick a name, so the
 * same account number always resolves to the same person (fallback mode). */
function hashAccountToName(accountNumber: string): string {
  let hash = 0;
  for (let i = 0; i < accountNumber.length; i++) {
    hash = Math.imul(31, hash) + accountNumber.charCodeAt(i) | 0;
  }
  const positiveHash = Math.abs(hash);
  const firstIdx = positiveHash % FIRST_NAMES.length;
  const lastIdx = (positiveHash * 17) % LAST_NAMES.length;
  return `${FIRST_NAMES[firstIdx]} ${LAST_NAMES[lastIdx]}`;
}

export async function POST(request: Request) {
  // A signed-in console session, and rate limits: this lookup reveals an
  // account holder's name and spends the Paystack quota.
  const refused = await guardLookup(request);
  if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status });
  try {
    const { accountNumber, bankCode, userId } = await request.json();

    // Connected to the Xtradot Bank sandbox: the bank's own name enquiry, made by
    // the API inside the cluster, as the signed-in console member.
    if (bridgeEnabled()) {
      return await bankEnquiry(request, String(accountNumber ?? ""), String(bankCode ?? ""), String(userId ?? ""));
    }

    if (!accountNumber || accountNumber.length !== 10) {
      return NextResponse.json(
        { error: "Invalid account number. Must be 10 digits." },
        { status: 400 }
      );
    }
    if (!bankCode) {
      return NextResponse.json({ error: "Bank code is required." }, { status: 400 });
    }

    // Older clients send the bank *name*; map either form to a real code.
    const bank = await findBank(String(bankCode));

    // Why we fell back, so the UI can label a simulated name honestly instead
    // of passing it off as a real NUBAN lookup.
    let fallbackReason: PaystackFailure = "no_key";

    if (paystackKey() && bank) {
      try {
        const resolved = await resolveAccount(accountNumber, bank.code);
        if (!resolved) {
          return NextResponse.json(
            { error: "Account number could not be resolved. Please check and try again." },
            { status: 404 }
          );
        }
        return NextResponse.json({ ...resolved, status: "success" });
      } catch (err) {
        fallbackReason = err instanceof PaystackError ? err.reason : "transport";
        if (fallbackReason === "ip_blocked") {
          console.error(
            "[paystack] /bank/resolve rejected this server's IP. The bank list may still " +
              "work — they are gated separately. Clear the Test IP allowlist in the Paystack " +
              "dashboard (empty = allow all). GET /api/paystack-status for details."
          );
        } else {
          console.error(`[paystack] resolve failed (${fallbackReason}):`, err);
        }
        // Fall through to the simulator rather than breaking the transfer flow.
      }
    }

    // ---- Fallback: deterministic simulator (no key configured) ----
    // Feels like a real NUBAN lookup (300–1200ms), fails a known test pattern.
    const delay = Math.floor(Math.random() * 900) + 300;
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (accountNumber.startsWith("0000")) {
      return NextResponse.json(
        { error: "Account number could not be resolved. Please check and try again." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      accountNumber,
      accountName: hashAccountToName(accountNumber),
      bankCode: bank?.code ?? String(bankCode),
      bankName: bank?.name ?? String(bankCode),
      source: "simulated",
      fallbackReason,
      status: "success",
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error during account resolution." },
      { status: 500 }
    );
  }
}

async function bankEnquiry(request: Request, accountNumber: string, bankCode: string, userId: string) {
  const bank = SANDBOX_BANKS.find((b) => b.code === bankCode || b.name === bankCode);
  if (!/^\d{10}$/.test(accountNumber) || !bank || !userId) {
    return NextResponse.json({ error: "Enter a 10-digit account number and choose its bank." }, { status: 400 });
  }
  const intra = bank.code === XTRADOT_CODE;
  try {
    const res = await fetch(`${API_BASE}/v1/forge/enquiry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fable-Session": request.headers.get("x-fable-session") ?? "",
      },
      body: JSON.stringify({ user_id: userId, account_number: accountNumber, bank_code: intra ? null : bank.code, intra }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as { account_name?: string; detail?: { message?: string } };
    if (!res.ok || !data.account_name) {
      const message = data.detail?.message ?? "The bank could not confirm this account. Check the number and bank.";
      return NextResponse.json({ error: message }, { status: res.status === 200 ? 404 : res.status });
    }
    return NextResponse.json({
      accountNumber,
      accountName: data.account_name,
      bankCode: bank.code,
      bankName: bank.name,
      source: "xtradot",
      status: "success",
    });
  } catch {
    return NextResponse.json({ error: "The bank did not answer. Try again in a moment." }, { status: 504 });
  }
}
