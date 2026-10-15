"use client";

import Link from "next/link";
import { useState } from "react";
import { useSWRConfig } from "swr";
import {
  ArrowSquareOut,
  ArrowUUpLeft,
  CheckCircle,
  Flag,
  Prohibit,
  UserCircle,
  Warning,
  X,
} from "@phosphor-icons/react";
import { Badge, Button, Notice, OutcomeBadge, RiskBadge, Skeleton } from "@/components/dashboard/primitives";
import {
  addCaseNote,
  assignCase,
  escalateCase,
  parseUtc,
  reopenCase,
  resolveCase,
  type CaseDetail as CaseDetailData,
} from "@/lib/fable/console";
import { formatNaira, formatRelativeTime, formatRiskScore } from "@/lib/fable/format";
import { CHANNEL_LABELS } from "@/lib/fable/scoring";
import type { ReviewState } from "@/lib/fable/types";
import { useCase, useMe, usePermissions } from "@/lib/fable/useConsole";

export const STATE_LABEL: Record<ReviewState, string> = {
  open: "Open",
  in_review: "In review",
  escalated: "Escalated",
  resolved: "Resolved",
};

export const STATE_TONE: Record<ReviewState, "neutral" | "brand" | "danger" | "success"> = {
  open: "neutral",
  in_review: "brand",
  escalated: "danger",
  resolved: "success",
};

const EVENT_LABEL: Record<string, string> = {
  "case.assigned": "Assigned",
  "case.escalated": "Escalated",
  "case.noted": "Note added",
  "case.resolved": "Resolved",
  "case.reopened": "Reopened",
};

/** Refresh everything that shows case state, after any change to a case. */
export function useRefreshCases() {
  const { mutate } = useSWRConfig();
  return () =>
    mutate(
      (key) =>
        Array.isArray(key) &&
        typeof key[0] === "string" &&
        (key[0].startsWith("console:review") || key[0] === "console:case" || key[0] === "console:txn-range"),
    );
}

function when(value: string | null | undefined): string {
  const t = parseUtc(value);
  return t ? formatRelativeTime(t) : "-";
}

export function CaseDetail({ id, onClose }: { id: string; onClose?: () => void }) {
  const { data, error, isLoading } = useCase(id);

  if (error) {
    return (
      <div className="p-5">
        <Notice tone="danger">{error.message || "Could not load this case."}</Notice>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return <CaseBody data={data} onClose={onClose} />;
}

function CaseBody({ data, onClose }: { data: CaseDetailData; onClose?: () => void }) {
  const t = data.case;
  const review = t.review;
  const state: ReviewState = review?.state ?? "open";
  const { canReview } = usePermissions();
  const { data: who } = useMe();
  const refresh = useRefreshCases();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState<"fraud" | "legitimate" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const resolved = state === "resolved";
  const mine = review?.assignee && who?.email && review.assignee === who.email;
  const color = t.riskScore >= 0.8 ? "#ef4444" : "#f59e0b";
  const h = data.history;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-d-border p-5">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <RiskBadge action={t.action} />
            <Badge tone={STATE_TONE[state]}>{STATE_LABEL[state]}</Badge>
            {review?.outcome && (
              <Badge tone={review.outcome === "fraud" ? "danger" : "success"}>
                {review.outcome === "fraud" ? "Confirmed fraud" : "Legitimate"}
              </Badge>
            )}
          </div>
          <p className="text-[24px] font-bold leading-tight tracking-tight text-d-text">{formatNaira(t.amount)}</p>
          <p className="mt-1 text-[13px] text-d-muted">
            <span className="font-semibold text-d-text">{t.customerName}</span> to{" "}
            <span className="font-semibold text-d-text">{t.recipientName}</span> · {t.recipientBank}
          </p>
          <p className="mt-0.5 text-[12px] text-d-faint">
            {CHANNEL_LABELS[t.channel]} · {formatRelativeTime(t.timestamp)} · {t.id}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close case"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-d-muted hover:bg-d-surface-2 hover:text-d-text"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-5 p-5">
        {/* Score and why */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-d-muted">Risk score</p>
            <span className="text-[13px] font-bold tabular-nums text-d-text">{formatRiskScore(t.riskScore)}</span>
          </div>
          {t.engineVersion != null && (
            <p className="-mt-1 mb-2 text-[11px] text-d-faint" title="The approved weights and thresholds that produced this score">
              Scored by engine v{t.engineVersion}
            </p>
          )}
          <div className="h-2 overflow-hidden rounded-full bg-d-surface-2">
            <div className="h-full rounded-full" style={{ width: `${Math.round(t.riskScore * 100)}%`, backgroundColor: color }} />
          </div>
          {t.explanation && <p className="mt-3 text-[13px] leading-relaxed text-d-muted">{t.explanation}</p>}
          {t.narration && (
            <p className="mt-2 text-[13px] text-d-muted">
              Narration: <span className="italic text-d-text">&ldquo;{t.narration}&rdquo;</span>
            </p>
          )}
        </section>

        {t.signals.length > 0 && (
          <section>
            <p className="mb-2 text-[12px] font-semibold text-d-muted">Signals that fired</p>
            <ul className="flex flex-col gap-1.5">
              {t.signals.map((s, i) => (
                <li key={s.code + i} className="flex items-start justify-between gap-3 rounded-xl bg-d-surface-2 px-3.5 py-2.5 text-[13px]">
                  <span className="min-w-0">
                    <span className="font-semibold text-d-text">{s.label}</span>
                    {s.detail && <span className="text-d-muted"> {s.detail}</span>}
                  </span>
                  <span className="shrink-0 rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand">
                    +{s.weight}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Customer context */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-d-muted">This customer at your bank</p>
            {t.userId && (
              <Link
                href={`/dashboard/customers/${encodeURIComponent(t.userId)}`}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:underline"
              >
                Customer profile <ArrowSquareOut size={12} />
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Fact label="Other transfers" value={h.transactions.toLocaleString("en-NG")} />
            <Fact label="Usual amount" value={h.transactions ? formatNaira(h.avg_amount) : "-"} />
            <Fact
              label="Paid this recipient"
              value={h.paid_this_recipient_before ? `${h.paid_this_recipient_before} times` : "Never"}
              warn={!h.paid_this_recipient_before}
            />
            <Fact
              label="Earlier flags"
              value={`${h.previously_flagged}${h.confirmed_fraud ? ` (${h.confirmed_fraud} fraud)` : ""}`}
              warn={h.confirmed_fraud > 0}
            />
          </div>
          {data.containment && (
            <p className="mt-2 text-[12px] text-d-muted">
              Ghost hold: <span className="font-semibold text-d-text">{data.containment.status.toLowerCase()}</span>
              {data.containment.cooling_window_minutes ? ` · ${data.containment.cooling_window_minutes} min window` : ""}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2 text-[12px] text-d-muted">
            Transfer status <OutcomeBadge status={t.status} />
          </div>
        </section>

        {/* Actions */}
        {canReview && (
          <section className="rounded-2xl border border-d-border p-4">
            {error && (
              <Notice tone="danger" className="mb-3">
                {error}
              </Notice>
            )}

            {resolved ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-d-muted">
                  Resolved by <span className="font-semibold text-d-text">{review?.reviewedBy ?? "-"}</span>
                  {review?.reviewedAt ? ` · ${formatRelativeTime(review.reviewedAt)}` : ""}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ArrowUUpLeft size={14} />}
                  loading={busy === "reopen"}
                  onClick={() => run("reopen", () => reopenCase(t.id))}
                >
                  Reopen
                </Button>
              </div>
            ) : deciding ? (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] font-semibold text-d-text">
                  {deciding === "fraud" ? "Confirm this as fraud" : "Mark this transfer as legitimate"}
                </p>
                <textarea
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  rows={2}
                  placeholder="What did you find? (optional)"
                  aria-label="Resolution note"
                  className="w-full resize-none rounded-xl border border-d-border bg-d-surface-2 px-3.5 py-2.5 text-[13px] text-d-text outline-none placeholder:text-d-faint focus:border-brand/50 focus:ring-4 focus:ring-brand/10"
                />
                <div className="flex gap-2">
                  <Button
                    variant={deciding === "fraud" ? "danger" : "primary"}
                    size="sm"
                    loading={busy === "resolve"}
                    onClick={() =>
                      run("resolve", async () => {
                        await resolveCase(t.id, deciding, decisionNote.trim());
                        setDeciding(null);
                        setDecisionNote("");
                      })
                    }
                  >
                    {deciding === "fraud" ? "Confirm fraud" : "Mark legitimate"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeciding(null)}>
                    Cancel
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-d-faint">
                  This labels the transfer and teaches Copilot. It does not move or release money; that only happens
                  through the customer&apos;s own verification.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-d-muted">
                  <UserCircle size={16} />
                  {review?.assignee ? (
                    <>
                      Assigned to <span className="font-semibold text-d-text">{mine ? "you" : review.assignee}</span>
                    </>
                  ) : (
                    "Unassigned"
                  )}
                  <span className="ml-auto flex gap-1.5">
                    {!mine ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy === "assign"}
                        onClick={() => run("assign", () => assignCase(t.id, "me"))}
                      >
                        Assign to me
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" loading={busy === "assign"} onClick={() => run("assign", () => assignCase(t.id, null))}>
                        Unassign
                      </Button>
                    )}
                    {state !== "escalated" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Flag size={14} />}
                        loading={busy === "escalate"}
                        onClick={() => run("escalate", () => escalateCase(t.id, note.trim() || undefined))}
                      >
                        Escalate
                      </Button>
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="danger" icon={<Prohibit size={16} weight="bold" />} onClick={() => setDeciding("fraud")}>
                    Confirm fraud
                  </Button>
                  <Button variant="success" icon={<CheckCircle size={16} weight="fill" />} onClick={() => setDeciding("legitimate")}>
                    Legitimate
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Notes */}
        <section>
          <p className="mb-2 text-[12px] font-semibold text-d-muted">Notes</p>
          {data.notes.length === 0 ? (
            <p className="text-[13px] text-d-faint">No notes yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.notes.map((n) => (
                <li key={n.id} className="rounded-xl bg-d-surface-2 px-3.5 py-2.5">
                  <p className="whitespace-pre-wrap text-[13px] text-d-text">{n.body}</p>
                  <p className="mt-1 text-[11px] text-d-faint">
                    {n.author} · {when(n.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {canReview && (
            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                run("note", async () => {
                  await addCaseNote(t.id, note.trim());
                  setNote("");
                });
              }}
            >
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Add a note for the team"
                aria-label="Add a note"
                className="w-full resize-none rounded-xl border border-d-border bg-d-surface-2 px-3.5 py-2.5 text-[13px] text-d-text outline-none placeholder:text-d-faint focus:border-brand/50 focus:ring-4 focus:ring-brand/10"
              />
              <Button type="submit" size="sm" variant="secondary" loading={busy === "note"} disabled={!note.trim()}>
                Add
              </Button>
            </form>
          )}
        </section>

        {/* Activity */}
        {data.activity.length > 0 && (
          <section>
            <p className="mb-2 text-[12px] font-semibold text-d-muted">Activity</p>
            <ol className="flex flex-col gap-2 border-l border-d-border pl-4">
              {data.activity.map((a, i) => (
                <li key={i} className="relative text-[12px] text-d-muted">
                  <span className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-d-surface bg-brand" />
                  <span className="font-semibold text-d-text">{EVENT_LABEL[a.event_type] ?? a.event_type}</span>
                  {typeof a.payload.outcome === "string" && ` as ${a.payload.outcome}`}
                  {typeof a.payload.by === "string" && ` by ${a.payload.by}`} · {when(a.created_at)}
                </li>
              ))}
            </ol>
          </section>
        )}

        {!canReview && (
          <Notice>
            <span className="inline-flex items-center gap-1.5">
              <Warning size={14} /> Your role can read cases but not change them.
            </span>
          </Notice>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-d-surface-2 px-3 py-2.5">
      <p className="text-[11px] font-medium text-d-muted">{label}</p>
      <p className={`truncate text-[14px] font-semibold ${warn ? "text-amber-600 dark:text-amber-400" : "text-d-text"}`}>{value}</p>
    </div>
  );
}
