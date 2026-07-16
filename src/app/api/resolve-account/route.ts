import { NextResponse } from "next/server";

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

/**
 * Deterministically hash a 10-digit account number to pick a name.
 * This ensures the same account number always resolves to the same person.
 */
function hashAccountToName(accountNumber: string): string {
  let hash = 0;
  for (let i = 0; i < accountNumber.length; i++) {
    hash = Math.imul(31, hash) + accountNumber.charCodeAt(i) | 0;
  }
  const positiveHash = Math.abs(hash);
  
  const firstIdx = positiveHash % FIRST_NAMES.length;
  // Use a slightly different multiplier for the last name so it's not always the same combination
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
      return NextResponse.json(
        { error: "Bank code is required." },
        { status: 400 }
      );
    }

    // Simulate real-world network latency (300ms - 1200ms) to feel like a real NUBAN lookup
    const delay = Math.floor(Math.random() * 900) + 300;
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Simulate a failure rate (e.g. 5% of the time, the account doesn't exist)
    // We deterministically fail certain specific patterns to allow for testing
    if (accountNumber.startsWith("0000")) {
      return NextResponse.json(
        { error: "Account number could not be resolved. Please check and try again." },
        { status: 404 }
      );
    }

    const accountName = hashAccountToName(accountNumber);

    return NextResponse.json({
      accountNumber,
      accountName,
      bankCode,
      status: "success"
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error during account resolution." },
      { status: 500 }
    );
  }
}
