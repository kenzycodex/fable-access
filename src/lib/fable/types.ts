// Shared domain model for the Fable demo bank (/demo) and the institution
// dashboard (/dashboard). Both surfaces read and write the same client-side
// store, so these types are the contract between them.

export type RiskAction = "PASS" | "FLAG" | "BLOCK";

export type Channel = "app" | "ussd" | "web" | "pos" | "atm";

/** How a recorded transfer ultimately resolved. */
export type TransactionStatus =
  | "completed" // cleared normally (PASS, or a FLAG the user verified)
  | "flagged" // Shield flagged, awaiting the user's decision
  | "blocked" // Shield blocked; not overridden
  | "cancelled" // user cancelled a flagged or blocked transfer
  | "held" // routed into Ghost, cooling window running
  | "released" // user confirmed out of Ghost, funds sent
  | "expired"; // the cooling window closed unconfirmed; nothing was sent

export interface Signal {
  /** Machine code, e.g. "amount_anomaly". */
  code: string;
  /** Human label, e.g. "Amount anomaly". */
  label: string;
  /** Plain-language detail, e.g. "8× above your usual transfers". */
  detail: string;
  /** How much this signal added to the risk score (0..1). */
  weight: number;
}

export interface Recipient {
  name: string;
  bank: string;
  bankCode: string;
  accountNumber: string;
  /** True when this account is already in the user's trusted list. */
  known: boolean;
  /** A saved recipient from the server: the token stands in for the account
   * number, which the browser never holds. */
  token?: string;
  /** "••1234", for display when only the token is known. */
  last4?: string;
}

/** The raw input to the scoring engine. */
export interface TransactionInput {
  amount: number;
  recipient: Recipient;
  narration: string;
  channel: Channel;
  /** Hour of day 0..23. Defaults to the current hour when omitted. */
  hour?: number;
}

/** The scoring engine's verdict for one transaction. */
export interface ScoreResult {
  riskScore: number; // 0..1
  action: RiskAction;
  signals: Signal[];
  explanation: string;
  latencyMs: number;
  /** Time to the verdict alone, which is what the 200ms budget governs.
   * `latencyMs` also covers persistence and the response itself. */
  decisionMs?: number;
  /** "pending" means a fuller write-up is being generated off the request
   * path and can be collected with `shieldExplanation(transactionId)`. */
  explanationSource?: "cache" | "template" | "llm" | "pending";
  transactionId?: string;
}

/** A recorded transaction, as stored and shown in both surfaces. */
export interface Transaction extends ScoreResult {
  id: string;
  timestamp: number; // ms epoch
  amount: number;
  direction: "debit" | "credit";
  channel: Channel;
  narration: string;
  status: TransactionStatus;
  recipientName: string;
  recipientBank: string;
  recipientAccount: string;
  /** Set when the transfer went to a saved recipient. */
  recipientToken?: string;
  /** The account holder who initiated it (for the institution feed). */
  customerName: string;
  /** The account holder's id. Live transfers persist per-institution, so this
   * is what scopes them to the selected customer — without it, one customer's
   * session transfers leak into another's feed after a switch. */
  userId?: string;
  /** True for transfers made live in /demo this session (vs. seeded). */
  live?: boolean;
  /** True when this transaction was scored/persisted by the Fable API. */
  remote?: boolean;
  /** What a person at the bank concluded. Only flagged and blocked transfers
   * are reviewed, so this is null for a pass. */
  review?: CaseReview | null;
  /** The engine version (approved weights and thresholds) that scored it.
   * Null on transfers scored before versions were recorded. */
  engineVersion?: number | null;
  /** The status of the hold opened from this decision, when known (review queue). */
  holdStatus?: string | null;
}

export type ReviewState = "open" | "in_review" | "escalated" | "resolved";
export type ReviewOutcome = "fraud" | "legitimate";

export interface CaseReview {
  state: ReviewState;
  outcome: ReviewOutcome | null;
  assignee: string | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
}

export interface GhostContainer {
  id: string;
  transactionId: string;
  amount: number;
  recipientName: string;
  recipientBank: string;
  /** Epoch ms when the cooling window expires. */
  expiresAt: number;
  /** Total cooling window in seconds (for the progress bar). */
  windowSeconds: number;
  status: "held" | "cancelled" | "released" | "expired";
  /** True when this container lives in the Fable API (not just locally). */
  remote?: boolean;
}

export interface TransparencyState {
  typicalRange: boolean;
  activeHours: boolean;
  trustedRecipients: boolean;
  knownDevices: boolean;
  channel: boolean;
  
  // Advanced Configuration settings
  velocityLimit: number;
  containmentWindow: number;
  biometricStrictness: number;
  geofenceRadius: number;
}

export interface Institution {
  id: string;
  name: string;
  type: string; // e.g. "Microfinance Bank"
  contactEmail: string;
}

export interface SessionState {
  loggedIn: boolean;
  institutionId: string | null;
  /** Signed session token from /auth/login. Presented on every API call so the
   *  server derives the tenant from a verified identity rather than from a
   *  query parameter the caller chooses. */
  token: string | null;
  /** Unix seconds. Lets the client stop using a token it knows is stale. */
  expiresAt: number | null;
}
