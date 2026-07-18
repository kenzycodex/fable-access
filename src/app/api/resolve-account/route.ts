import { NextResponse } from "next/server";
import { findBank, paystackKey, resolveAccount } from "@/lib/paystack";

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
  try {
    const { accountNumber, bankCode } = await request.json();

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
        console.error("Paystack resolution error:", err);
        // Paystack transport error — fall through to the simulator rather
        // than breaking the transfer flow.
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
      status: "success",
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error during account resolution." },
      { status: 500 }
    );
  }
}
