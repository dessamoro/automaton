import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  scanCodeContent,
  auditPackageDependencies,
  generateResponsibleDisclosure,
  performSecurityAudit,
} from "../../recon/security-audit.js";

describe("Security Vulnerability & SAST Audit Engine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("detects dangerous logic sinks such as eval and Function constructor", async () => {
    const dangerousCode = `
      function runUserCode(userInput: string) {
        const result = eval(userInput);
        return result;
      }
    `;

    const findings = await scanCodeContent("src/executor.ts", dangerousCode);
    expect(findings.length).toBeGreaterThan(0);
    const evalFinding = findings.find(f => f.title.includes("eval"));
    expect(evalFinding).toBeDefined();
    expect(evalFinding?.severity).toBe("critical");
    expect(evalFinding?.line).toBe(3);
  });

  it("detects secret patterns and flags them as critical leaks", async () => {
    const codeWithSecret = `
      const config = {
        awsKey: "AKIAIOSFODNN7ABCDEFG",
        endpoint: "https://s3.amazonaws.com"
      };
    `;

    const findings = await scanCodeContent("src/aws.ts", codeWithSecret);
    const awsFinding = findings.find(f => f.title.includes("AWS Access Key"));
    expect(awsFinding).toBeDefined();
    expect(awsFinding?.severity).toBe("critical");
    expect(awsFinding?.matchSnippet).toContain("AKIAIO");
  });

  it("detects mutable GitHub action branch pins in workflows", async () => {
    const workflowYaml = `
      name: CI
      on: [push]
      jobs:
        build:
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@master
    `;

    const findings = await scanCodeContent(".github/workflows/ci.yml", workflowYaml);
    const actionFinding = findings.find(f => f.category === "supply_chain");
    expect(actionFinding).toBeDefined();
    expect(actionFinding?.severity).toBe("medium");
    expect(actionFinding?.remediation).toContain("commit SHA");
  });

  it("audits dependencies for known vulnerabilities", async () => {
    const packageJson = JSON.stringify({
      dependencies: {
        "event-stream": "3.3.6",
        "lodash": "4.17.15",
      },
    });

    const findings = await auditPackageDependencies(packageJson);
    expect(findings.length).toBe(2);
    expect(findings.some(f => f.title.includes("event-stream"))).toBe(true);
    expect(findings.some(f => f.title.includes("lodash"))).toBe(true);
  });

  it("generates a structured responsible disclosure report", async () => {
    const report = await performSecurityAudit({
      owner: "acme-corp",
      repo: "web-app",
      sampleFiles: {
        "package.json": JSON.stringify({ dependencies: { "event-stream": "3.3.6" } }),
        "src/dangerous.js": "const out = eval(input);",
      },
    });

    expect(report.target.owner).toBe("acme-corp");
    expect(report.target.repo).toBe("web-app");
    expect(report.totalFindings).toBe(2);
    expect(report.score).toBeLessThan(70); // Penalized for critical eval & vuln dependency
    expect(report.responsibleDisclosure).toContain("Responsible Disclosure & Security Assessment Report");
    expect(report.responsibleDisclosure).toContain("acme-corp/web-app");
  });
});
