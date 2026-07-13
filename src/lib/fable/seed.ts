// Seed data for the demo. Everything here is synthetic and hardcoded (the
// "90 days of history" the brief describes), not generated at runtime, so the
// demo bank and dashboard both open onto a realistic, populated world.

import type { Institution, Recipient, Transaction } from "./types";

/** The single institution the dashboard authenticates against. Fictional, so
 * nothing here implies a real bank has deployed Fable. */
export const INSTITUTION: Institution = {
  id: "meridian",
  name: "Meridian MFB",
  type: "Microfinance Bank",
  contactEmail: "risk@meridian.ng",
};

/** Demo login credentials, shown on the login screen so a judge can sign
 * straight in. Not real, not checked against anything. */
export const DEMO_CREDENTIALS = {
  email: "risk@meridian.ng",
  password: "fable-demo",
};

/** The demo bank's account holder (the person using /demo). */
export const DEMO_USER = {
  name: "Ada Obi",
  firstName: "Ada",
  balance: 847_320,
  accountMask: "•••• 4821",
  institutionId: INSTITUTION.id,
  threatsBlockedThisMonth: 2,
  transfersSecuredThisMonth: 47,
};

/** Contacts shown on the transfer screen. "Unknown" is deliberately new, so
 * selecting it starts to build risk. */
export const CONTACTS: Recipient[] = [
  { name: "Mum", bank: "Access Bank", bankCode: "044", accountNumber: "0123453456", known: true },
  { name: "Landlord", bank: "GTBank", bankCode: "058", accountNumber: "0211889900", known: true },
  { name: "Chioma", bank: "UBA", bankCode: "033", accountNumber: "2079004411", known: true },
  { name: "Unknown", bank: "Zenith Bank", bankCode: "057", accountNumber: "0987654321", known: false },
];

/** Quick-amount chips on the transfer screen. */
export const QUICK_AMOUNTS = [5_000, 10_000, 50_000, 200_000];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Build a completed, low-risk transaction (the kind Copilot clears silently). */
function cleared(
  id: string,
  customerName: string,
  recipientName: string,
  recipientBank: string,
  amount: number,
  direction: "debit" | "credit",
  ageMs: number,
  channel: Transaction["channel"] = "app",
  narration = "",
): Transaction {
  return {
    id,
    timestamp: Date.now() - ageMs,
    amount,
    direction,
    channel,
    narration,
    status: "completed",
    riskScore: 0.03 + (Math.abs(hash(id)) % 7) / 100,
    action: "PASS",
    signals: [],
    explanation: "Cleared instantly, matches normal behavior.",
    latencyMs: 120 + (Math.abs(hash(id)) % 60),
    recipientName,
    recipientBank,
    recipientAccount: `••••${1000 + (Math.abs(hash(id)) % 9000)}`,
    customerName,
  };
}

/** Ada's own recent history, shown on the demo home screen. All cleared. */
export const SEED_USER_HISTORY: Transaction[] = [
  cleared("u1", DEMO_USER.name, "Mum", "Access Bank", 10_000, "debit", 2 * DAY, "app", "food money"),
  cleared("u2", DEMO_USER.name, "NEPA Prepaid", "Meridian MFB", 15_400, "debit", 3 * DAY, "app", "electricity"),
  cleared("u3", DEMO_USER.name, "Chioma", "UBA", 50_000, "credit", 4 * DAY, "app", "refund"),
  cleared("u4", DEMO_USER.name, "Mr Biggs", "Meridian MFB", 3_200, "debit", 5 * DAY, "pos", "lunch"),
  cleared("u5", DEMO_USER.name, "Landlord", "GTBank", 6_500, "debit", 6 * DAY, "app", "service charge"),
];

/** The institution-wide feed the dashboard reads: many customers, a mix of
 * outcomes so Alerts, Intelligence, and Compliance all have real data. */
export const SEED_INSTITUTION_FEED: Transaction[] = [
  // Ada's history is part of the institution's feed too.
  ...SEED_USER_HISTORY,

  cleared("f1", "Tunde Bello", "SLOT Systems", "Zenith Bank", 42_000, "debit", 1 * HOUR, "app", "laptop repair"),
  cleared("f2", "Ngozi Eze", "Mum", "First Bank", 8_000, "debit", 2 * HOUR, "app", "upkeep"),
  cleared("f3", "Emeka Obi", "Shoprite", "GTBank", 23_500, "debit", 3 * HOUR, "pos", "groceries"),
  cleared("f4", "Fatima Sani", "MTN Data", "Meridian MFB", 5_000, "debit", 4 * HOUR, "ussd", "data"),
  cleared("f5", "Bola Ade", "DStv", "Meridian MFB", 18_600, "debit", 5 * HOUR, "web", "subscription"),
  cleared("f6", "Ibrahim Musa", "Landlord", "UBA", 120_000, "debit", 6 * HOUR, "app", "rent"),
  cleared("f7", "Grace John", "Jumia", "Access Bank", 34_200, "debit", 8 * HOUR, "web", "order"),

  // A flagged transfer: unusual amount + new recipient, cleared after review.
  {
    id: "f8",
    timestamp: Date.now() - 7 * HOUR,
    amount: 180_000,
    direction: "debit",
    channel: "web",
    narration: "supplier payment",
    status: "completed",
    riskScore: 0.58,
    action: "FLAG",
    signals: [
      { code: "amount_anomaly", label: "Amount anomaly", detail: "6× larger than usual", weight: 0.22 },
      { code: "new_recipient", label: "New recipient", detail: "First transfer to this account", weight: 0.2 },
      { code: "channel_risk", label: "Higher-risk channel", detail: "Web carries more risk", weight: 0.18 },
    ],
    explanation: "Flagged for review. Customer confirmed the supplier and cleared it.",
    latencyMs: 156,
    recipientName: "BuildRite Ltd",
    recipientBank: "Fidelity Bank",
    recipientAccount: "••••7731",
    customerName: "Chidi Nwosu",
  },

  // Two blocked scam attempts: the Watch/Alerts screen surfaces these.
  {
    id: "f9",
    timestamp: Date.now() - 9 * HOUR,
    amount: 500_000,
    direction: "debit",
    channel: "ussd",
    narration: "urgent help abeg",
    status: "blocked",
    riskScore: 0.94,
    action: "BLOCK",
    signals: [
      { code: "amount_anomaly", label: "Amount anomaly", detail: "40× larger than usual", weight: 0.3 },
      { code: "new_recipient", label: "New recipient", detail: "First transfer to this account", weight: 0.2 },
      { code: "channel_risk", label: "Higher-risk channel", detail: "USSD carries more risk", weight: 0.25 },
      { code: "scam_pattern", label: "Urgency (Pidgin)", detail: "Matches a known scam script", weight: 0.3 },
    ],
    explanation: "Blocked. Amount, new recipient, USSD channel, and a Pidgin urgency script.",
    latencyMs: 143,
    recipientName: "Unknown",
    recipientBank: "Zenith Bank",
    recipientAccount: "••••4321",
    customerName: "Aisha Bello",
  },
  {
    id: "f10",
    timestamp: Date.now() - 26 * HOUR,
    amount: 250_000,
    direction: "debit",
    channel: "web",
    narration: "double your money forex",
    status: "blocked",
    riskScore: 0.86,
    action: "BLOCK",
    signals: [
      { code: "amount_anomaly", label: "Amount anomaly", detail: "20× larger than usual", weight: 0.3 },
      { code: "new_recipient", label: "New recipient", detail: "First transfer to this account", weight: 0.2 },
      { code: "scam_pattern", label: "Investment fraud", detail: "Matches a known scam script", weight: 0.4 },
    ],
    explanation: "Blocked. Investment-fraud narration to a brand-new recipient.",
    latencyMs: 138,
    recipientName: "FX Global Pro",
    recipientBank: "Providus Bank",
    recipientAccount: "••••9052",
    customerName: "Samuel Okafor",
  },

  cleared("f11", "Halima Yusuf", "Konga", "Wema Bank", 15_900, "debit", 28 * HOUR, "web", "order"),
  cleared("f12", "Peter Adeyemi", "Mum", "Access Bank", 12_000, "debit", 30 * HOUR, "app", "upkeep"),
  cleared("f13", "Blessing Umeh", "Landlord", "GTBank", 90_000, "debit", 2 * DAY, "app", "rent"),
  cleared("f14", "Yakubu Danladi", "Fuel Station", "Meridian MFB", 25_000, "debit", 2 * DAY, "pos", "fuel"),
  cleared("f15", "Rita Okon", "School Fees", "First Bank", 145_000, "debit", 3 * DAY, "web", "tuition"),

  // A held (Ghost) transaction that was later cancelled.
  {
    id: "f16",
    timestamp: Date.now() - 3 * DAY - 4 * HOUR,
    amount: 320_000,
    direction: "debit",
    channel: "app",
    narration: "new account use this instead",
    status: "cancelled",
    riskScore: 0.83,
    action: "BLOCK",
    signals: [
      { code: "amount_anomaly", label: "Amount anomaly", detail: "26× larger than usual", weight: 0.3 },
      { code: "new_recipient", label: "New recipient", detail: "First transfer to this account", weight: 0.2 },
      { code: "scam_pattern", label: "Supplier account-change", detail: "Matches a known scam script", weight: 0.45 },
    ],
    explanation: "Blocked, held in Ghost, then cancelled by the customer.",
    latencyMs: 149,
    recipientName: "Vendor (new acct)",
    recipientBank: "Polaris Bank",
    recipientAccount: "••••1180",
    customerName: "Uche Eze",
  },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
