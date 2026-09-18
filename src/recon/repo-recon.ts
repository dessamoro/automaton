/**
 * Repository Reconnaissance Engine
 *
 * Provides non-intrusive structural analysis of open-source GitHub repositories:
 * - Detects package ecosystems, build harnesses, and CI setups.
 * - Assesses test suites and contribution guidelines.
 * - Computes an autonomous contribution readiness score.
 *
 * Used both as a native agent tool and as an x402 paid micro-service ($0.25 USDC).
 */

export interface RepoReconParams {
  owner: string;
  repo: string;
  branch?: string;
}

export interface RepoReconReport {
  repository: {
    fullName: string;
    description: string;
    stars: number;
    forks: number;
    openIssues: number;
    license: string;
    defaultBranch: string;
    isArchived: boolean;
    url: string;
  };
  ecosystem: {
    primaryLanguage: string;
    packageManagers: string[];
    manifestFiles: string[];
  };
  testingAndCi: {
    hasCi: boolean;
    workflows: string[];
    detectedFrameworks: string[];
  };
  hygiene: {
    hasReadme: boolean;
    hasContributing: boolean;
    hasSecurityPolicy: boolean;
    hasLicense: boolean;
  };
  assessment: {
    complexityScore: "low" | "medium" | "high";
    readyForAutonomousContribution: boolean;
    summary: string;
  };
  timestamp: string;
}

const MANIFEST_DETECTORS: Record<string, { pm: string; framework?: string }> = {
  "package.json": { pm: "npm/pnpm/yarn" },
  "Cargo.toml": { pm: "cargo", framework: "rust" },
  "go.mod": { pm: "go modules", framework: "go" },
  "pyproject.toml": { pm: "poetry/uv/pip", framework: "python" },
  "requirements.txt": { pm: "pip", framework: "python" },
  "foundry.toml": { pm: "foundry", framework: "solidity" },
  "hardhat.config.js": { pm: "hardhat", framework: "solidity" },
  "hardhat.config.ts": { pm: "hardhat", framework: "solidity" },
  "CMakeLists.txt": { pm: "cmake", framework: "c/c++" },
  "Makefile": { pm: "make" },
};

export async function performRepoRecon(
  params: RepoReconParams,
  customFetch: typeof fetch = fetch,
): Promise<RepoReconReport> {
  const { owner, repo } = params;
  if (!owner || !repo) {
    throw new Error("Missing required parameters: 'owner' and 'repo'");
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Conway-Automaton/0.2.1",
  };

  const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  // 1. Fetch Repository Metadata
  const repoRes = await customFetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) {
    if (repoRes.status === 404) {
      throw new Error(`Repository '${owner}/${repo}' not found or is private.`);
    }
    if (repoRes.status === 403) {
      throw new Error(`GitHub API rate limit exceeded while querying '${owner}/${repo}'.`);
    }
    throw new Error(`Failed to fetch repo metadata: HTTP ${repoRes.status}`);
  }

  const repoData = (await repoRes.json()) as any;

  // 2. Fetch Root Directory Contents
  let rootFiles: { name: string; type: string }[] = [];
  try {
    const contentsRes = await customFetch(`https://api.github.com/repos/${owner}/${repo}/contents`, { headers });
    if (contentsRes.ok) {
      rootFiles = (await contentsRes.json()) as any[];
    }
  } catch {
    // Non-fatal if contents cannot be listed
  }

  const rootNames = new Set(rootFiles.map((f) => f.name.toLowerCase()));

  // 3. Detect Package Ecosystem & Manifests
  const detectedPms = new Set<string>();
  const detectedManifests: string[] = [];
  const detectedFrameworks = new Set<string>();

  for (const [manifest, meta] of Object.entries(MANIFEST_DETECTORS)) {
    if (rootNames.has(manifest.toLowerCase())) {
      detectedManifests.push(manifest);
      detectedPms.add(meta.pm);
      if (meta.framework) detectedFrameworks.add(meta.framework);
    }
  }

  // 4. Detect CI / Workflows
  let hasCi = false;
  const workflows: string[] = [];
  const hasDotGithub = rootFiles.some((f) => f.name === ".github" && f.type === "dir");

  if (hasDotGithub) {
    try {
      const wfRes = await customFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/.github/workflows`,
        { headers },
      );
      if (wfRes.ok) {
        const wfFiles = (await wfRes.json()) as any[];
        if (Array.isArray(wfFiles)) {
          for (const wf of wfFiles) {
            if (wf.name.endsWith(".yml") || wf.name.endsWith(".yaml")) {
              workflows.push(wf.name);
            }
          }
          hasCi = workflows.length > 0;
        }
      }
    } catch {
      // Workflows directory optional
    }
  }

  // 5. Hygiene Check
  const hasReadme = Array.from(rootNames).some((n) => n.startsWith("readme"));
  const hasContributing = Array.from(rootNames).some((n) => n.startsWith("contributing"));
  const hasSecurityPolicy = Array.from(rootNames).some((n) => n.startsWith("security"));
  const hasLicense = !!repoData.license?.spdx_id;

  // 6. Complexity & Readiness Scoring
  const openIssues = repoData.open_issues_count || 0;
  const sizeKb = repoData.size || 0;

  let complexityScore: "low" | "medium" | "high" = "medium";
  if (sizeKb > 50_000 || openIssues > 300) {
    complexityScore = "high";
  } else if (sizeKb < 5_000 && openIssues < 50) {
    complexityScore = "low";
  }

  const readyForAutonomousContribution = !repoData.archived && hasCi && hasReadme && detectedManifests.length > 0;

  let summary = `Repository ${repoData.full_name} (${repoData.language || "Unknown"}) has ${detectedManifests.length} manifest file(s). `;
  if (hasCi) {
    summary += `CI pipeline detected with ${workflows.length} workflow(s). `;
  } else {
    summary += `No GitHub Actions CI detected. `;
  }
  summary += readyForAutonomousContribution
    ? "Well-structured for automated testing and contribution."
    : "May require manual setup before autonomous execution.";

  return {
    repository: {
      fullName: repoData.full_name || `${owner}/${repo}`,
      description: repoData.description || "",
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      openIssues,
      license: repoData.license?.spdx_id || repoData.license?.name || "None",
      defaultBranch: repoData.default_branch || "main",
      isArchived: !!repoData.archived,
      url: repoData.html_url || `https://github.com/${owner}/${repo}`,
    },
    ecosystem: {
      primaryLanguage: repoData.language || "Unknown",
      packageManagers: Array.from(detectedPms),
      manifestFiles: detectedManifests,
    },
    testingAndCi: {
      hasCi,
      workflows,
      detectedFrameworks: Array.from(detectedFrameworks),
    },
    hygiene: {
      hasReadme,
      hasContributing,
      hasSecurityPolicy,
      hasLicense,
    },
    assessment: {
      complexityScore,
      readyForAutonomousContribution,
      summary,
    },
    timestamp: new Date().toISOString(),
  };
}
