import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionContext } from "@/lib/fable/session";
import { safeNext } from "@/lib/safeNext";

describe("safeNext", () => {
  it("keeps a path on this site", () => {
    expect(safeNext("/demo/bank/transfer")).toBe("/demo/bank/transfer");
  });

  it.each([["https://evil.example"], ["//evil.example"], ["/\\evil.example"], ["/ok\\..\\x"], [""], [null]])(
    "refuses %s",
    (value) => expect(safeNext(value)).toBe("/dashboard"),
  );
});

describe("getSessionContext", () => {
  beforeEach(() => sessionStorage.clear());

  it("does not claim how the customer signed in", () => {
    expect(getSessionContext().auth_method).toBeNull();
  });

  it("measures the session from its start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T09:00:00Z"));
    getSessionContext();
    vi.setSystemTime(new Date("2026-10-01T09:00:42Z"));
    expect(getSessionContext().session_duration_seconds).toBe(42);
    vi.useRealTimers();
  });
});
