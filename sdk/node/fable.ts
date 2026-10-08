/**
 * Fable reference client for Node.js 18+ (TypeScript or JavaScript).
 *
 * No dependencies: it uses the built-in fetch and node:crypto. Copy this file
 * into your service, or import it from the repository.
 *
 *   const fable = new Fable({ baseUrl: process.env.FABLE_API_URL!, apiKey: process.env.FABLE_API_KEY! });
 *   const verdict = await fable.analyze({ userId: "cust_10293", transaction: { amount: 250000, recipientAccount: "0111222333" } });
 *
 * Server-side only. The API key must never reach a browser or a mobile app.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type Channel = "mobile_app" | "ussd" | "pos" | "internet" | "atm" | "qr" | "branch" | "unknown";
export type Action = "PASS" | "FLAG" | "BLOCK";

export interface TransferInput {
  amount: number;
  recipientAccount: string;
  recipientBankCode?: string;
  recipientName?: string;
  narration?: string;
  channel?: Channel;
  currency?: "NGN";
}

export interface AnalyzeInput {
  userId: string;
  transaction: TransferInput;
  /** Your own id for this transfer. Makes a retry return the original decision. */
  clientReference?: string;
  device?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface Verdict {
  risk_score: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  action: Action;
  signals: string[];
  explanation: string;
  explanation_source: string;
  decision_ms: number;
  latency_ms: number;
  transaction_id: string;
}

export interface FableEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  created_at: string;
  institution_id: string;
  data: T;
}

export class FableError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export class Fable {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl: string; apiKey: string; timeoutMs?: number }) {
    if (!opts.apiKey) throw new Error("Fable: an API key is required.");
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    // Scoring targets well under 200ms. The timeout leaves room for the network,
    // and the caller decides what a timeout means (treat it as a FLAG).
    this.timeoutMs = opts.timeoutMs ?? 1500;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-API-Key": this.apiKey },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const detail = parsed?.detail;
      const message = typeof detail === "string" ? detail : (detail?.message ?? `Fable API returned ${res.status}`);
      throw new FableError(message, res.status, parsed);
    }
    return parsed as T;
  }

  /** Score a transfer before money moves. */
  analyze(input: AnalyzeInput): Promise<Verdict> {
    const t = input.transaction;
    return this.request("POST", "/v1/shield/analyze", {
      user_id: input.userId,
      client_reference: input.clientReference,
      device: input.device,
      context: input.context,
      transaction: {
        amount: t.amount,
        currency: t.currency ?? "NGN",
        recipient_account: t.recipientAccount,
        recipient_bank_code: t.recipientBankCode,
        recipient_name: t.recipientName,
        narration: t.narration,
        channel: t.channel ?? "mobile_app",
      },
    });
  }

  /**
   * Score a transfer, treating a timeout or outage as a FLAG.
   * Fable itself never fails open; this keeps your integration from doing so either.
   */
  async analyzeOrFlag(input: AnalyzeInput): Promise<Verdict | { action: "FLAG"; unavailable: true }> {
    try {
      return await this.analyze(input);
    } catch (err) {
      if (err instanceof FableError && err.status < 500) throw err; // your request was wrong; fix it
      return { action: "FLAG", unavailable: true };
    }
  }

  /** Report how a decision turned out. */
  feedback(userId: string, transactionId: string, wasFraud: boolean) {
    return this.request<{ status: string; outcome: string }>("POST", "/v1/shield/feedback", {
      user_id: userId,
      transaction_id: transactionId,
      was_fraud: wasFraud,
    });
  }

  /** Which factor a flagged transfer needs before it can proceed. */
  stepUpRequirement(userId: string, verdict: Pick<Verdict, "risk_score" | "signals" | "action">) {
    return this.request<{ level: string }>("POST", "/v1/stepup/requirement", {
      user_id: userId,
      risk_score: verdict.risk_score,
      signals: verdict.signals,
      action: verdict.action,
      purpose: "transfer",
    });
  }

  /** Approve a flagged transfer once the customer has passed the factor. */
  approve(transactionId: string, userId: string, stepupToken: string) {
    return this.request("POST", `/v1/transactions/${encodeURIComponent(transactionId)}/approve`, {
      user_id: userId,
      stepup_token: stepupToken,
    });
  }

  /** Hold a blocked transfer the customer insists on, so the money stays recoverable. */
  hold(input: { userId: string; riskScore: number; signals: string[]; explanation?: string; transaction: TransferInput }) {
    return this.request<{ ghost_id: string; cooling_window_minutes: number; expires_at: string }>("POST", "/v1/ghost/create", {
      user_id: input.userId,
      risk_score: input.riskScore,
      signals: input.signals,
      explanation: input.explanation ?? "",
      transaction: {
        amount: input.transaction.amount,
        recipient_account: input.transaction.recipientAccount,
        recipient_name: input.transaction.recipientName,
        channel: input.transaction.channel ?? "mobile_app",
      },
    });
  }

  cancelHold(ghostId: string, userId: string) {
    return this.request("POST", `/v1/ghost/${encodeURIComponent(ghostId)}/cancel`, { user_id: userId });
  }

  releaseHold(ghostId: string, userId: string, stepupToken: string) {
    return this.request("POST", `/v1/ghost/${encodeURIComponent(ghostId)}/confirm`, {
      user_id: userId,
      stepup_token: stepupToken,
    });
  }
}

/**
 * Verify a webhook delivery and return the parsed event, or null if it is not
 * genuine or is too old to trust. Pass the raw request body, not parsed JSON.
 */
export function verifyWebhook<T = Record<string, unknown>>(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSeconds = 300,
): FableEvent<T> | null {
  if (!signatureHeader) return null;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds || !parts.v1) return null;

  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return JSON.parse(body) as FableEvent<T>;
}
