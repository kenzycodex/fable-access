"use client";

import { useRef, useState } from "react";
import { DEMO_CUSTOMERS, DEMO_PAYEES, DEMO_PIN, SCENARIOS, type Scenario } from "@/lib/forge/demo-data";
import styles from "./forge.module.css";

type Decision = {
  risk_score: number;
  risk_level: string;
  action: "PASS" | "FLAG" | "BLOCK";
  signals: string[];
  explanation: string;
  decision_ms: number;
};
type Transfer = {
  id: string;
  reference: string;
  state: string;
  amount: number;
  fee: number | null;
  vat: number | null;
  stamp_duty: number | null;
  total_debit: number | null;
  last_error: string | null;
  trail?: { state: string; note: string | null }[];
};
type Hold = { ghost_id: string; cooling_window_minutes?: number };
type Run = {
  key: string;
  n: number;
  user: string;
  payeeName?: string;
  decision?: Decision;
  transfer?: Transfer;
  next?: string | null;
  hold?: Hold | null;
  note?: string;
  error?: string;
  working?: string;
};

const FINAL = ["successful", "failed", "reversed", "cancelled"];
const STATE_LABEL: Record<string, string> = {
  successful: "Sent",
  failed: "Failed",
  reversed: "Reversed",
  cancelled: "Cancelled",
  pending: "Pending at the bank",
  unknown: "Outcome unknown, asking the bank",
  sending: "Sending",
  held: "Held, nothing sent",
  awaiting_stepup: "Waiting for the customer to verify",
};

const TRAIL_LABEL: Record<string, string> = {
  decided: "Cleared by Fable",
  awaiting_stepup: "Waiting for the customer to verify",
  held: "Held by Ghost",
  unknown: "No answer from the bank",
  pending: "Pending at the bank",
  successful: "Successful",
  failed: "Failed",
  reversed: "Reversed",
  cancelled: "Cancelled",
};

const money = (n: number | null | undefined) =>
  n == null ? "n/a" : `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Called only from button handlers, never while rendering.
const newKey = (n: number) => `${Date.now()}-${n}`;
const newReference = (n: number) => `demo-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 8)}`;

async function call(action: string, body: Record<string, unknown>) {
  const res = await fetch("/api/forge-demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, json };
}

function failure(json: Record<string, unknown>): string {
  const d = json.detail as { message?: string } | string | undefined;
  return (typeof d === "object" ? d?.message : d) || (json.message as string) || "Something went wrong.";
}

export default function ForgeDemo() {
  const [active, setActive] = useState<Scenario>(SCENARIOS[0]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [pins, setPins] = useState<Record<string, string>>({});
  const stop = useRef(false);

  const patch = (key: string, change: Partial<Run>) =>
    setRuns((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)));

  async function settle(run: Run, id: string) {
    for (let i = 0; i < 40 && !stop.current; i++) {
      const { ok, json } = await call("status", { user_id: run.user, id });
      if (ok) {
        const t = json as unknown as Transfer;
        patch(run.key, { transfer: t, working: FINAL.includes(t.state) ? undefined : STATE_LABEL[t.state] ?? t.state });
        if (FINAL.includes(t.state)) return;
      }
      await sleep(3000);
    }
    patch(run.key, { working: undefined });
  }

  async function one(s: Scenario, n: number) {
    const customer = DEMO_CUSTOMERS.find((c) => c.ref === s.customer)!;
    const payee = DEMO_PAYEES.find((p) => p.account === s.payee)!;
    const run: Run = { key: newKey(n), n, user: customer.ref, working: "Checking who owns the account" };
    setRuns((prev) => [...prev, run]);

    const enq = await call("enquiry", { user_id: customer.ref, account_number: payee.account });
    if (!enq.ok) return patch(run.key, { working: undefined, error: failure(enq.json) });
    const nameRef = enq.json.name_enquiry_ref as string;
    patch(run.key, { payeeName: enq.json.account_name as string, working: "Fable is scoring the transfer" });

    const res = await call("transfer", {
      user_id: customer.ref,
      source_account: customer.account,
      destination_account: payee.account,
      amount: s.amount,
      name_enquiry_ref: nameRef,
      client_reference: newReference(n),
    });
    if (!res.ok) return patch(run.key, { working: undefined, error: failure(res.json) });
    const j = res.json as unknown as { decision: Decision; transfer: Transfer; next: string | null; hold: Hold | null };
    patch(run.key, { decision: j.decision, transfer: j.transfer, next: j.next, hold: j.hold, working: undefined });
    if (!FINAL.includes(j.transfer.state) && j.transfer.state !== "held" && j.transfer.state !== "awaiting_stepup") {
      patch(run.key, { working: "Waiting for the bank. Fable is asking, not resending." });
      await settle(run, j.transfer.id);
    }
  }

  async function start(s: Scenario) {
    stop.current = false;
    setBusy(true);
    setRuns([]);
    for (let i = 1; i <= (s.repeat ?? 1) && !stop.current; i++) await one(s, i);
    setBusy(false);
  }

  async function verify(run: Run) {
    if (!run.transfer) return;
    patch(run.key, { error: undefined, working: "Verifying the PIN" });
    const pin = await call("pin", { user_id: run.user, id: run.transfer.id, pin: pins[run.key] ?? "" });
    if (!pin.ok) return patch(run.key, { working: undefined, error: failure(pin.json) });
    patch(run.key, { working: "Sending to the bank" });
    const done = await call("confirm", { user_id: run.user, id: run.transfer.id, stepup_token: pin.json.token });
    if (!done.ok) return patch(run.key, { working: undefined, error: failure(done.json) });
    patch(run.key, { transfer: done.json as unknown as Transfer, next: null, working: undefined });
    await settle(run, run.transfer.id);
  }

  async function cancel(run: Run) {
    if (!run.transfer) return;
    const res = await call("cancel", { user_id: run.user, id: run.transfer.id });
    if (!res.ok) return patch(run.key, { error: failure(res.json) });
    patch(run.key, { transfer: res.json as unknown as Transfer, next: null, note: "Cancelled by the customer. Nothing was ever sent." });
  }

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Fable on the Xtradot Bank sandbox</p>
          <h1>Every transfer is judged before the money moves</h1>
          <p className={styles.lede}>
            Real calls to the bank&apos;s sandbox, made from inside the cluster. Pick a scenario and watch one transfer from name enquiry to the bank&apos;s answer.
          </p>
        </div>
      </header>

      <div className={styles.layout}>
        <nav className={styles.scenarios} aria-label="Scenarios">
          {SCENARIOS.map((s, i) => (
            <button
              key={s.id}
              className={`${styles.scenario} ${active.id === s.id ? styles.on : ""}`}
              onClick={() => !busy && setActive(s)}
              disabled={busy}
            >
              <span className={styles.num}>{i + 1}</span>
              <span>
                <strong>{s.title}</strong>
                <small>{s.story}</small>
              </span>
            </button>
          ))}
        </nav>

        <section className={styles.stage}>
          <div className={styles.brief}>
            <div>
              <h2>{active.title}</h2>
              <p>
                {DEMO_CUSTOMERS.find((c) => c.ref === active.customer)?.name} sends {money(active.amount)}
                {active.repeat ? ` × ${active.repeat}` : ""} to {DEMO_PAYEES.find((p) => p.account === active.payee)?.bank}.
              </p>
              <p className={styles.expect}>Expect: {active.expect}</p>
            </div>
            <button className={styles.run} onClick={() => start(active)} disabled={busy}>
              {busy ? "Running…" : runs.length ? "Run again" : "Run scenario"}
            </button>
          </div>

          {runs.map((run) => (
            <article key={run.key} className={styles.card}>
              {run.n > 0 && active.repeat ? <p className={styles.count}>Transfer {run.n} of {active.repeat}</p> : null}

              <div className={styles.step}>
                <span className={styles.dot} data-done={Boolean(run.payeeName)} />
                <div>
                  <h3>Name enquiry</h3>
                  <p>{run.payeeName ? `The bank says this account belongs to ${run.payeeName}.` : "Asking the bank…"}</p>
                </div>
              </div>

              <div className={styles.step}>
                <span className={styles.dot} data-done={Boolean(run.decision)} />
                <div>
                  <h3>Fable&apos;s decision</h3>
                  {run.decision ? (
                    <>
                      <p>
                        <span className={`${styles.badge} ${styles[run.decision.action]}`}>{run.decision.action}</span>{" "}
                        score {run.decision.risk_score.toFixed(2)}, {run.decision.risk_level.toLowerCase()} risk, decided in {run.decision.decision_ms} ms
                      </p>
                      <div className={styles.meter}>
                        <i style={{ width: `${Math.min(100, run.decision.risk_score * 100)}%` }} data-level={run.decision.action} />
                      </div>
                      <ul className={styles.signals}>
                        {run.decision.signals.map((sig) => (
                          <li key={sig}>{sig}</li>
                        ))}
                      </ul>
                      <p className={styles.explain}>{run.decision.explanation}</p>
                    </>
                  ) : (
                    <p>{run.working ?? "Waiting"}</p>
                  )}
                </div>
              </div>

              {run.decision && (
                <div className={styles.step}>
                  <span className={styles.dot} data-done={Boolean(run.transfer && FINAL.includes(run.transfer.state))} />
                  <div>
                    <h3>The bank</h3>
                    {run.transfer && (
                      <>
                        <p>
                          <span className={`${styles.badge} ${styles[run.transfer.state] ?? ""}`}>
                            {STATE_LABEL[run.transfer.state] ?? run.transfer.state}
                          </span>
                          {run.working ? <span className={styles.wait}> {run.working}</span> : null}
                        </p>
                        {run.transfer.fee != null && (
                          <dl className={styles.charges}>
                            <dt>Fee</dt><dd>{money(run.transfer.fee)}</dd>
                            <dt>VAT</dt><dd>{money(run.transfer.vat)}</dd>
                            <dt>Stamp duty</dt><dd>{money(run.transfer.stamp_duty)}</dd>
                            <dt>Total debit</dt><dd>{money(run.transfer.total_debit)}</dd>
                          </dl>
                        )}
                        {(run.transfer.trail?.length ?? 0) > 1 && (
                          <ol className={styles.trail}>
                            {run.transfer.trail!.map((step, i) => (
                              <li key={`${step.state}-${i}`}>
                                {TRAIL_LABEL[step.state] ?? step.state}
                                {step.state === "unknown" ? " (asked the bank, did not resend)" : ""}
                              </li>
                            ))}
                          </ol>
                        )}
                        <p className={styles.ref}>Reference {run.transfer.reference}</p>
                        {run.transfer.last_error && <p className={styles.err}>{run.transfer.last_error}</p>}
                      </>
                    )}

                    {run.next === "step_up" && (
                      <div className={styles.action}>
                        <p>Fable needs the customer to confirm it is them. Demo PIN: {DEMO_PIN}</p>
                        <input
                          inputMode="numeric"
                          maxLength={6}
                          type="password"
                          placeholder="PIN"
                          value={pins[run.key] ?? ""}
                          onChange={(e) => setPins((p) => ({ ...p, [run.key]: e.target.value }))}
                          aria-label="PIN"
                        />
                        <button onClick={() => verify(run)} disabled={Boolean(run.working)}>Verify and send</button>
                        <button className={styles.ghost} onClick={() => cancel(run)}>Cancel</button>
                      </div>
                    )}

                    {run.next === "ghost_hold" && (
                      <div className={styles.action}>
                        <p>
                          Ghost is holding this transfer{run.hold?.cooling_window_minutes ? ` for ${run.hold.cooling_window_minutes} minutes` : ""}. Nothing was sent. Cancelling is free; releasing it needs proof a hijacked session cannot produce.
                        </p>
                        <button className={styles.ghost} onClick={() => cancel(run)}>Cancel the transfer</button>
                      </div>
                    )}
                    {run.note && <p className={styles.explain}>{run.note}</p>}
                  </div>
                </div>
              )}

              {run.error && <p className={styles.err}>{run.error}</p>}
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
