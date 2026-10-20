import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BehavioralTracker } from "@/lib/fable/biometrics";

describe("BehavioralTracker time to submit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("stops at tapping Send, and the review sheet's time is its own field", () => {
    const t = new BehavioralTracker();
    vi.advanceTimersByTime(2_000);
    t.recordKey("amount");
    vi.advanceTimersByTime(4_000);
    t.markSend(); // 6s on the form
    vi.advanceTimersByTime(25_000); // reading the review sheet
    const s = t.snapshot();
    expect(s.time_to_first_input_seconds).toBe(2);
    expect(s.time_to_submit_seconds).toBe(6);
    expect(s.review_seconds).toBe(25);
  });

  it("after Recheck, the later Send counts", () => {
    const t = new BehavioralTracker();
    vi.advanceTimersByTime(5_000);
    t.markSend();
    vi.advanceTimersByTime(3_000); // Recheck, edit the amount
    vi.advanceTimersByTime(4_000);
    t.markSend();
    vi.advanceTimersByTime(2_000);
    const s = t.snapshot();
    expect(s.time_to_submit_seconds).toBe(12);
    expect(s.review_seconds).toBe(2);
  });

  it("without a review step, time to submit runs to the snapshot", () => {
    const t = new BehavioralTracker();
    vi.advanceTimersByTime(7_500);
    const s = t.snapshot();
    expect(s.time_to_submit_seconds).toBe(7.5);
    expect(s.review_seconds).toBeNull();
  });
});
