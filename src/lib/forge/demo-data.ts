// The Forge demo's cast: the Xtradot Bank sandbox's own synthetic people and
// accounts (platform guide, section 5.4), and the five scripted scenarios.
// Shared by the page and by the server route that guards what the page may do.

export type DemoCustomer = { ref: string; name: string; account: string; note: string };
export type DemoPayee = { account: string; name: string; bank: string; bankCode: string | null; intra: boolean };

export const DEMO_CUSTOMERS: DemoCustomer[] = [
  { ref: "demo_adaeze", name: "Adaeze Chiamaka Okonkwo", account: "0123456789", note: "Savings, tier 3" },
  { ref: "demo_babatunde", name: "Babatunde Olumide Adeyemi", account: "0123456790", note: "Current, tier 3" },
  { ref: "demo_musa", name: "Musa Ibrahim Abdullahi", account: "0123456791", note: "Savings, tier 2" },
  { ref: "demo_efosa", name: "Efosa Godwin Osagie", account: "0123456792", note: "Savings, tier 1" },
  { ref: "demo_mama", name: "Mama Nkechi Provisions Ltd", account: "0123456793", note: "Corporate" },
];

export const DEMO_PAYEES: DemoPayee[] = [
  { account: "0123987001", name: "Chukwuemeka Ifeanyi Nwosu", bank: "GTBank", bankCode: "000013", intra: false },
  { account: "0987654321", name: "Ngozi Adaobi Eze", bank: "Xtradot Bank", bankCode: null, intra: true },
  { account: "0123987002", name: "Funmilayo Abiola Ogunleye", bank: "Zenith Bank", bankCode: "000015", intra: false },
  { account: "0123987004", name: "Tamunotonye Briggs", bank: "UBA", bankCode: "000004", intra: false },
];

export type Scenario = {
  id: string;
  title: string;
  story: string;
  expect: string;
  customer: string;
  payee: string;
  amount: number;
  repeat?: number;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "normal",
    title: "A normal transfer",
    story: "Adaeze sends a small amount to GTBank. Nothing about it is unusual.",
    expect: "Passes with no extra step. The bank's fee and VAT come straight from its reply.",
    customer: "demo_adaeze",
    payee: "0123987001",
    amount: 5000,
  },
  {
    id: "large",
    title: "A large amount to a new payee",
    story: "A corporate account sends ₦6,000,000 to someone it has never paid. The amount has no history to compare against.",
    expect: "Held by Ghost with the reasons. Nothing is sent to the bank.",
    customer: "demo_mama",
    payee: "0123987001",
    amount: 6_000_000,
  },
  {
    id: "stepup",
    title: "A transfer that needs a check",
    story: "Babatunde sends ₦200,000 to a new payee. It is not alarming, but it is not routine either.",
    expect: "Flagged. The customer verifies with a PIN, then it is sent.",
    customer: "demo_babatunde",
    payee: "0123987001",
    amount: 200_000,
  },
  {
    id: "burst",
    title: "A rapid burst",
    story: "Efosa sends six small transfers to the same person in a row.",
    expect: "The first looks new; the next ones are known and cheap, but the velocity signal climbs with every one.",
    customer: "demo_efosa",
    payee: "0123987001",
    amount: 2000,
    repeat: 6,
  },
  {
    id: "timeout",
    title: "The bank's answer is lost",
    story: "Musa sends ₦5,000.02. The sandbox's trigger for this amount is a timeout, then a failure and reversal 30 seconds later.",
    expect: "Fable never resends. It asks the bank for the status until the outcome is final, so there is one debit and one reversal.",
    customer: "demo_musa",
    payee: "0123987001",
    amount: 5000.02,
  },
];

export const DEMO_PIN = "1234";
export const MAX_AMOUNT = 10_000_000;
