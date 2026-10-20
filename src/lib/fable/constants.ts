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
/** How an agent's status reads in the console. Anything unknown is shown as
 * "Unknown", never as running. */
export const AGENT_STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  active: { label: "Running", tone: "success" },
  degraded: { label: "Needs attention", tone: "warning" },
  off: { label: "Off", tone: "neutral" },
  planned: { label: "Planned", tone: "neutral" },
};

export function agentStatus(status: string | undefined) {
  return (status && AGENT_STATUS[status]) || { label: "Unknown", tone: "neutral" as const };
}

export const CHANNEL_LABELS = {
  app: "Mobile App",
  ussd: "USSD",
  pos: "POS",
  web: "Web",
  atm: "ATM",
} as const;
