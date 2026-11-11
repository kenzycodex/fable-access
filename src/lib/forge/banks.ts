import type { Bank } from "@/lib/paystack";

// The banks the Xtradot Bank sandbox knows (platform guide, section 5.4), with
// the NIP codes its transfers use. The names match the API's bridge
// (api/services/forge_bridge.py), which maps a saved recipient's bank by name.
export const SANDBOX_BANKS: Bank[] = [
  { name: "Xtradot Bank", code: "000014", slug: "xtradot-bank" },
  { name: "GTBank", code: "000013", slug: "gtbank" },
  { name: "Zenith Bank", code: "000015", slug: "zenith-bank" },
  { name: "First Bank of Nigeria", code: "000016", slug: "first-bank-of-nigeria" },
  { name: "UBA", code: "000004", slug: "uba" },
  { name: "Wema Bank", code: "000017", slug: "wema-bank" },
  { name: "OPay", code: "100004", slug: "opay" },
  { name: "Moniepoint MFB", code: "090405", slug: "moniepoint-mfb" },
  { name: "Kuda MFB", code: "090267", slug: "kuda-mfb" },
  { name: "PalmPay", code: "100033", slug: "palmpay" },
];

export const XTRADOT_CODE = "000014";

/** The site is connected to the Xtradot Bank sandbox (server-side setting). */
export function bridgeEnabled(): boolean {
  return process.env.FORGE_BRIDGE === "1";
}
