import { describe, expect, it } from "vitest";
import { passMessage } from "@/lib/fable/decision";

describe("passMessage", () => {
  it("says it matched their usual banking only when judged against their own history", () => {
    expect(passMessage("personal")).toMatch(/matched how you normally bank/);
  });

  it.each([["population"], ["none"], [null], [undefined]] as const)(
    "is honest for a customer without their own history (%s)",
    (source) => {
      const message = passMessage(source);
      expect(message).not.toMatch(/normally bank/);
      expect(message).toBe("Nothing unusual was found for this transfer, so it went through with no extra steps.");
    },
  );
});
