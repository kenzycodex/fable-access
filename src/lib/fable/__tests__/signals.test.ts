import { describe, expect, it } from "vitest";
import { parseApiSignals } from "@/lib/fable/api";
import { agentStatus } from "@/lib/fable/constants";

describe("parseApiSignals", () => {
  it("reads the code, a plain label, the detail and the points", () => {
    const [s] = parseApiSignals(["amount_anomaly: 12x above your baseline (+0.28)"]);
    expect(s).toMatchObject({ code: "amount_anomaly", label: "Amount anomaly", detail: "12x above your baseline", weight: 0.28 });
  });

  it("groups every NIP code under one label", () => {
    expect(parseApiSignals(["nip_34: Suspected fraud"])[0]).toMatchObject({ code: "nip_code", label: "NIP risk code" });
  });

  it("names the anomaly signal for a person, not a model", () => {
    expect(parseApiSignals(["ml_anomaly: unusual (+0.05)"])[0].label).toBe("Unusual for this customer");
  });
});

describe("agentStatus", () => {
  it("never shows an unknown status as running", () => {
    expect(agentStatus("active").label).toBe("Running");
    expect(agentStatus("degraded").label).toBe("Needs attention");
    expect(agentStatus("planned").label).toBe("Planned");
    expect(agentStatus("something-new").label).toBe("Unknown");
    expect(agentStatus(undefined).label).toBe("Unknown");
  });
});
