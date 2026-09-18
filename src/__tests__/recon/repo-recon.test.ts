import { describe, it, expect, vi } from "vitest";
import { performRepoRecon } from "../../recon/repo-recon.js";

describe("Repository Reconnaissance Engine", () => {
  it("throws an error if owner or repo is missing", async () => {
    await expect(performRepoRecon({ owner: "", repo: "test" })).rejects.toThrow("Missing required parameters");
    await expect(performRepoRecon({ owner: "test", repo: "" })).rejects.toThrow("Missing required parameters");
  });

  it("analyzes repository structure and CI workflows correctly", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/contents/.github/workflows")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { name: "test.yml", type: "file" },
            { name: "lint.yaml", type: "file" },
          ],
        };
      }
      if (url.includes("/contents")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { name: "package.json", type: "file" },
            { name: "README.md", type: "file" },
            { name: "CONTRIBUTING.md", type: "file" },
            { name: ".github", type: "dir" },
          ],
        };
      }
      if (url.includes("/repos/facebook/react")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            full_name: "facebook/react",
            description: "A declarative, efficient, and flexible JavaScript library for building user interfaces.",
            stargazers_count: 220000,
            forks_count: 45000,
            open_issues_count: 800,
            language: "JavaScript",
            default_branch: "main",
            archived: false,
            license: { spdx_id: "MIT" },
            html_url: "https://github.com/facebook/react",
            size: 150000,
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const report = await performRepoRecon(
      { owner: "facebook", repo: "react" },
      mockFetch as unknown as typeof fetch,
    );

    expect(report.repository.fullName).toBe("facebook/react");
    expect(report.repository.stars).toBe(220000);
    expect(report.repository.license).toBe("MIT");
    expect(report.ecosystem.packageManagers).toContain("npm/pnpm/yarn");
    expect(report.ecosystem.manifestFiles).toContain("package.json");
    expect(report.testingAndCi.hasCi).toBe(true);
    expect(report.testingAndCi.workflows).toEqual(["test.yml", "lint.yaml"]);
    expect(report.hygiene.hasReadme).toBe(true);
    expect(report.hygiene.hasContributing).toBe(true);
    expect(report.assessment.complexityScore).toBe("high"); // large size & high issues
    expect(report.assessment.readyForAutonomousContribution).toBe(true);
  });

  it("handles 404 repository gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(
      performRepoRecon(
        { owner: "nonexistent", repo: "missing" },
        mockFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow("not found or is private");
  });
});
