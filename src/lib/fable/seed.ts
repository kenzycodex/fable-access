// Fixed choices on the demo bank's transfer screen. Everything else the demo
// shows (customers, balances, history) comes from the API, so it matches the
// institution that was provisioned rather than data compiled into the bundle.

import type { Recipient } from "./types";

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
