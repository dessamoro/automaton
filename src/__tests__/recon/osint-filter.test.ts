import { describe, it, expect } from "vitest";
import { filterOsintAnomalies } from "../../recon/osint-filter.js";

describe("filterOsintAnomalies (System 0)", () => {
  it("should aggregate total and status breakdown deterministically", () => {
    const raw = [
      { host: "a.com", status: 200 },
      { host: "b.com", status: 404 },
      { host: "c.com", status: 403 },
      { host: "d.com", status: 200 },
      { host: "e.com", status: 502 },
    ];

    const resultStr = filterOsintAnomalies(raw);
    const result = JSON.parse(resultStr);

    expect(result.totalScanned).toBe(5);
    expect(result.statusBreakdown["200"]).toBe(2);
    expect(result.statusBreakdown["404"]).toBe(1);
    expect(result.statusBreakdown["403"]).toBe(1);
    expect(result.statusBreakdown["502"]).toBe(1);
  });

  it("should filter out known ignored hosts", () => {
    const raw = [
      { host: "known.com", status: 200 },
      { host: "unknown.com", status: 200 },
    ];

    const resultStr = filterOsintAnomalies(raw, { ignoreHosts: ["known.com"] });
    const result = JSON.parse(resultStr);

    expect(result.anomaliesFound).toBe(1);
    expect(result.anomalies[0].host).toBe("unknown.com");
  });

  it("should cap the number of returned anomalies based on maxTokens", () => {
    const raw = Array.from({ length: 100 }, (_, i) => ({
      host: `host-${i}.com`,
      status: 200,
    }));

    // If maxTokens = 600, heuristic (600 * 0.8 / 30) = 16 max items
    const resultStr = filterOsintAnomalies(raw, { maxTokens: 600 });
    const result = JSON.parse(resultStr);

    expect(result.totalScanned).toBe(100);
    expect(result.anomaliesFound).toBe(100);
    expect(result.anomaliesShown).toBe(16);
    expect(result.anomalies.length).toBe(16);
  });
});
