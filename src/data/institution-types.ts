// The kinds of institution Fable is built for. It is not only for banks: it sits
// in the transfer flow of banks, fintechs, wallets, payment companies and the
// like, so the list covers Nigerian and wider African licence categories as well
// as plain descriptions.
//
// This is a label the institution chooses for itself. Nothing in the product
// branches on it, so an institution that fits none of these can type its own.

export interface InstitutionTypeGroup {
  label: string;
  types: string[];
}

export const INSTITUTION_TYPE_GROUPS: InstitutionTypeGroup[] = [
  {
    label: "Banks",
    types: [
      "Commercial Bank",
      "Merchant Bank",
      "Microfinance Bank",
      "Digital Bank",
      "Non-Interest (Islamic) Bank",
      "Payment Service Bank",
      "Mortgage Bank",
      "Development Finance Institution",
      "Cooperative or Credit Union",
    ],
  },
  {
    label: "Fintech and payments",
    types: [
      "Fintech",
      "Payment Service Provider",
      "Payment Gateway",
      "Payment Aggregator or Acquirer",
      "Switching and Processing Company",
      "Wallet Provider",
      "Mobile Money Operator",
      "Remittance or Money Transfer Operator",
      "Digital Lender",
      "Buy Now Pay Later",
    ],
  },
  {
    label: "Other regulated",
    types: [
      "Virtual Asset Service Provider",
      "Insurance Company",
      "Pension Fund Administrator",
      "Capital Markets or Brokerage",
      "Telecoms or Mobile Network Operator",
    ],
  },
];

/** The type given to a newly provisioned institution that did not choose one.
 * Deliberately neutral: it used to default to "Microfinance Bank", which was
 * wrong for almost everyone. */
export const DEFAULT_INSTITUTION_TYPE = "Financial Institution";

export const ALL_INSTITUTION_TYPES: string[] = INSTITUTION_TYPE_GROUPS.flatMap((g) => g.types);

/** The "none of these" choice in the picker, which reveals a text box. */
export const OTHER_TYPE = "__other__";
