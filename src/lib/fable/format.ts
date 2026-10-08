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

/** Small, stable string hash (FNV-1a). Used to derive demo identifiers that stay
 * the same for a given customer across reloads without storing anything. */
function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Digits derived from a seed, e.g. a 10-digit NUBAN-style account number. */
function digitsFor(seed: string, length: number): string {
  let out = "";
  let n = 0;
  while (out.length < length) {
    out += String(hashString(`${seed}:${n++}`)).padStart(10, "0");
  }
  return out.slice(0, length);
}

/** The demo account number for a customer: 10 digits, stable per customer. */
export function accountNumberFor(userId: string): string {
  return digitsFor(`acct:${userId}`, 10);
}

/** The customer's demo debit card. Derived, never stored, and clearly a demo:
 * there is no card network behind it. */
export function cardFor(userId: string): { number: string; last4: string; expiry: string } {
  const number = digitsFor(`card:${userId}`, 16);
  const month = (hashString(`m:${userId}`) % 12) + 1;
  const year = 28 + (hashString(`y:${userId}`) % 3);
  return {
    number,
    last4: number.slice(-4),
    expiry: `${String(month).padStart(2, "0")}/${year}`,
  };
}

/** "1234567890" -> "1234 5678 90" style grouping for display. */
export function groupDigits(value: string, size = 4): string {
  return value.replace(new RegExp(`(.{${size}})`, "g"), "$1 ").trim();
}

/** A greeting that fits the device's clock. */
export function greetingForNow(date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}

/** "8 Oct 2026, 2:14 PM" */
export function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}`;
}
