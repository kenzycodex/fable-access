import { describe, expect, it } from "vitest";
import { amountMagnitude, formatNaira } from "@/lib/fable/format";

describe("amountMagnitude", () => {
  it("names the size of an amount so a slipped zero is noticed", () => {
    expect(amountMagnitude(999)).toBe("");
    expect(amountMagnitude(5_000)).toBe("Thousands");
    expect(amountMagnitude(50_000)).toBe("Tens of thousands");
    expect(amountMagnitude(500_000)).toBe("Hundreds of thousands");
    expect(amountMagnitude(5_000_000)).toBe("Millions");
    expect(amountMagnitude(900_000_000)).toBe("Hundreds of millions");
    expect(amountMagnitude(2_000_000_000)).toBe("Billions");
  });
});

describe("formatNaira", () => {
  it("rounds to whole naira with Nigerian grouping", () => {
    expect(formatNaira(1234567.6)).toBe("₦1,234,568");
  });
});
