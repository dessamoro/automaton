import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  queryDoh,
  queryCertificateTransparency,
  performDomainRecon,
} from "../../recon/domain-recon.js";

describe("Domain & Infrastructure OSINT Engine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("queries DNS-over-HTTPS and parses Answer records", async () => {
    const mockDohResponse = {
      Status: 0,
      Answer: [
        { name: "example.com.", type: 1, TTL: 300, data: "93.184.216.34" },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockDohResponse,
    } as any);

    const records = await queryDoh("example.com", "A");
    expect(records).toHaveLength(1);
    expect(records[0].data).toBe("93.184.216.34");
    expect(records[0].type).toBe(1);
  });

  it("extracts and dedupes subdomains from Certificate Transparency logs", async () => {
    const mockCrtResponse = [
      { name_value: "api.example.com\nexample.com" },
      { name_value: "*.example.com" },
      { name_value: "staging.example.com" },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockCrtResponse,
    } as any);

    const subdomains = await queryCertificateTransparency("example.com");
    expect(subdomains).toContain("api.example.com");
    expect(subdomains).toContain("staging.example.com");
    // Wildcards should be filtered
    expect(subdomains).not.toContain("*.example.com");
  });

  it("performs complete domain reconnaissance and assesses email security", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("type=A")) {
        return {
          ok: true,
          json: async () => ({ Answer: [{ data: "1.2.3.4" }, { data: "1.2.3.5" }] }),
        } as any;
      }
      if (urlStr.includes("type=MX")) {
        return {
          ok: true,
          json: async () => ({ Answer: [{ data: "10 mail.example.com" }] }),
        } as any;
      }
      if (urlStr.includes("type=TXT") && urlStr.includes("_dmarc")) {
        return {
          ok: true,
          json: async () => ({ Answer: [{ data: "v=DMARC1; p=reject;" }] }),
        } as any;
      }
      if (urlStr.includes("type=TXT")) {
        return {
          ok: true,
          json: async () => ({ Answer: [{ data: "v=spf1 include:_spf.example.com ~all" }] }),
        } as any;
      }
      if (urlStr.includes("crt.sh")) {
        return {
          ok: true,
          json: async () => [{ name_value: "auth.example.com" }],
        } as any;
      }
      return { ok: false } as any;
    });

    const report = await performDomainRecon("https://example.com/");
    expect(report.domain).toBe("example.com");
    expect(report.ipAddresses).toHaveLength(2);
    expect(report.mailServers).toContain("mail.example.com");
    expect(report.spfConfigured).toBe(true);
    expect(report.dmarcConfigured).toBe(true);
    expect(report.subdomains).toContain("auth.example.com");
    expect(report.securityScore).toBeGreaterThanOrEqual(90);
  });
});
