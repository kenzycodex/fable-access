// Plain shared constants — deliberately NOT a "use client" module.
//
// Server components (the /demo redirect, the [institution] layout) need these
// values as real strings. Importing them from a "use client" module hands the
// server a client-reference proxy instead, which produced an invalid Location
// header when the /demo redirect tried to interpolate one.

/** The promise made to a payment rail: Shield reaches its verdict within this
 * many milliseconds. Both the Overview and Compliance pages measure against it. */
export const LATENCY_BUDGET_MS = 200;

/** Display names for the demo's channels. */
export const CHANNEL_LABELS = {
  app: "Mobile App",
  ussd: "USSD",
  pos: "POS",
  web: "Web",
  atm: "ATM",
} as const;
