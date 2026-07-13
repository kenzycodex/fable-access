// Formatting helpers shared across the demo bank and dashboard.

/** ₦ with grouped thousands and no decimals, e.g. 500000 -> "₦500,000". */
export function formatNaira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString("en-NG")}`;
}

/** Compact ₦ for tight stat tiles, e.g. 25850000000 -> "₦25.9bn". */
export function formatNairaCompact(amount: number): string {
  if (amount >= 1_000_000_000) return `₦${(amount / 1_000_000_000).toFixed(2)}bn`;
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}m`;
  if (amount >= 1_000) return `₦${(amount / 1_000).toFixed(0)}k`;
  return `₦${amount}`;
}

/** Relative time like "2m ago", "3h ago", "Yesterday", or a date. */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

/** Clock time like "2:14 PM". */
export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
}

/** Mask an account number to its last 4 digits, e.g. "0987654321" -> "•••• 4321". */
export function maskAccount(accountNumber: string): string {
  const last4 = accountNumber.slice(-4);
  return `•••• ${last4}`;
}

/** Format a 0..1 risk score to two decimals, e.g. 0.94 -> "0.94". */
export function formatRiskScore(score: number): string {
  return score.toFixed(2);
}

/** mm:ss from a number of seconds. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
