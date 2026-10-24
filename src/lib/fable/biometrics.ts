"use client";

// Fable SDK — passive behavioural signals on the transfer page. Nothing leaves
// the page until submit, when snapshot() is bundled into the Shield request.
//
// Only what Fable uses is collected:
//   paste detection and time to submit  scored by Shield (behavioral_anomaly)
//   time to first input                 stored with the decision
//   time on the review sheet            stored with the decision, not scored
//   average typing interval             shown to analysts as context, not scored
//
// Time to submit runs from the page opening to the customer tapping Send, as it
// did before the review sheet existed. Time spent reading the sheet is reported
// on its own (review_seconds), so the check-before-you-send step does not make
// every transfer look slow and deliberate to Shield.
//
// Pointer speed, scroll direction changes and keypress counts used to be
// collected too. The server never stored or scored them, so they are no longer
// gathered at all.
//
// The page wires it through React events (onKeyDown/onPaste per field).

export interface BehavioralProfile {
  /** Average interval between keypresses across tracked fields, in ms. Context for analysts only. */
  typing_speed_ms: number | null;
  /** True if any tracked field received pasted content. */
  paste_detected: boolean;
  pasted_fields: string[];
  time_to_first_input_seconds: number | null;
  /** Page opening to tapping Send (the form, not the review sheet). */
  time_to_submit_seconds: number;
  /** Tapping Send to confirming on the review sheet; null without a sheet. */
  review_seconds: number | null;
}

export class BehavioralTracker {
  private mountedAt = Date.now();
  private firstInputAt: number | null = null;
  private lastKeyAt: number | null = null;
  private keyIntervals: number[] = [];
  private pastedFields = new Set<string>();
  private sendAt: number | null = null;

  /** Kept so callers written for the older tracker still work; there are no
   * global listeners any more. */
  start(): void {}

  stop(): void {}

  /** Call from a tracked field's onKeyDown. The field name is accepted so this
   * mirrors `recordPaste(field)` at every call site, even though keystroke
   * cadence is tracked across fields rather than per field. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  recordKey(_field: string): void {
    const now = Date.now();
    if (this.firstInputAt === null) this.firstInputAt = now;
    if (this.lastKeyAt !== null) {
      const interval = now - this.lastKeyAt;
      // > 3s gaps are "thinking", not typing cadence.
      if (interval > 0 && interval < 3_000) {
        this.keyIntervals.push(interval);
        if (this.keyIntervals.length > 400) this.keyIntervals.shift();
      }
    }
    this.lastKeyAt = now;
  }

  /** Call from a tracked field's onPaste. */
  recordPaste(field: string): void {
    const now = Date.now();
    if (this.firstInputAt === null) this.firstInputAt = now;
    this.pastedFields.add(field);
  }

  /** Call when the customer taps Send, before the review sheet opens. A
   * Recheck and a second Send moves it to the later tap. */
  markSend(): void {
    this.sendAt = Date.now();
  }

  snapshot(): BehavioralProfile {
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const typing = avg(this.keyIntervals);
    const now = Date.now();
    const seconds = (ms: number) => Math.round(ms / 100) / 10;
    return {
      typing_speed_ms: typing === null ? null : Math.round(typing),
      paste_detected: this.pastedFields.size > 0,
      pasted_fields: [...this.pastedFields],
      time_to_first_input_seconds:
        this.firstInputAt === null ? null : Math.round((this.firstInputAt - this.mountedAt) / 100) / 10,
      time_to_submit_seconds: seconds((this.sendAt ?? now) - this.mountedAt),
      review_seconds: this.sendAt === null ? null : seconds(now - this.sendAt),
    };
  }
}
