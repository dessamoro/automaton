/**
 * Bounty Hunter Service
 *
 * Discovers and inspects active developer bounties from Algora and Bountycaster.
 */

import { createLogger } from "../observability/logger.js";

const logger = createLogger("bounties");

export interface BountyItem {
  id: string;
  source: "algora" | "bountycaster" | "github" | "base_onchain";
  title: string;
  url: string;
  rewardUsd: number;
  tags: string[];
  repo?: string;
  issueNumber?: number;
  status: "open" | "in_progress" | "completed";
  createdAt?: string;
  network?: string;
  escrowAddress?: string;
}

export interface FetchBountiesOptions {
  source?: "github" | "algora" | "bountycaster" | "base_onchain" | "all";
  minRewardUsd?: number;
  maxRewardUsd?: number;
  tag?: string;
  limit?: number;
}

/**
 * Fetch active bounties directly from GitHub Issues (label:bounty, open)
 */
export async function fetchGitHubBounties(options?: FetchBountiesOptions): Promise<BountyItem[]> {
  try {
    const limit = Math.min(options?.limit ?? 10, 30);
    const tagPart = options?.tag ? `+${encodeURIComponent(options.tag)}` : "";
    const url = `https://api.github.com/search/issues?q=label:bounty+is:open+is:issue${tagPart}&sort=created&order=desc&per_page=${limit}`;

    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Lakshmi-Automaton/1.0",
    };
    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      logger.warn(`GitHub Bounties API responded with status ${response.status}`);
      return [];
    }

    const data = (await response.json()) as any;
    const items = Array.isArray(data.items) ? data.items : [];

    const parsed: BountyItem[] = items.map((item: any) => {
      let rewardUsd = 0;
      const textToSearch = `${item.title} ${item.body || ""}`;
      const rewardMatch = textToSearch.match(/\$([0-9]+(?:\.[0-9]{2})?)/) || textToSearch.match(/([0-9]+)\s*(?:USD|USDC|DAI)/i);
      if (rewardMatch && rewardMatch[1]) {
        rewardUsd = parseFloat(rewardMatch[1].replace(/,/g, "")) || 0;
      }

      const labels = Array.isArray(item.labels) ? item.labels.map((l: any) => (typeof l === "string" ? l : l.name || "")) : [];
      const repoName = item.repository_url ? item.repository_url.replace("https://api.github.com/repos/", "") : undefined;

      return {
        id: `github-${item.id || item.number}`,
        source: "github",
        title: item.title || "GitHub Bounty Issue",
        url: item.html_url || item.url || "https://github.com",
        rewardUsd,
        tags: labels.filter(Boolean),
        repo: repoName,
        issueNumber: item.number,
        status: "open",
        createdAt: item.created_at || new Date().toISOString(),
      };
    });

    return filterBounties(parsed, options);
  } catch (error) {
    logger.warn("Failed to fetch GitHub bounties", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Fetch on-chain bounties and locked escrows on Base network
 */
export async function fetchBaseEscrows(options?: FetchBountiesOptions): Promise<BountyItem[]> {
  try {
    // Query public on-chain bounty indexer / Base protocol events
    const url = "https://api.bountycaster.xyz/bounties/open?platform=base";
    const response = await fetch(url, {
      headers: {
        "Accept": "*/*",
        "User-Agent": "Lakshmi-Automaton/1.0",
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as any;
    const items = Array.isArray(data) ? data : data.bounties || data.items || [];

    const parsed: BountyItem[] = items.map((item: any) => ({
      id: `base-${item.id || item.escrowAddress || Math.random().toString(36).substring(2)}`,
      source: "base_onchain",
      title: item.title || item.text || "Base Protocol Bounty Escrow",
      url: item.url || item.link || "https://basescan.org",
      rewardUsd: parseFloat(String(item.amountUsd || item.amount || 0)) || 0,
      tags: ["base", "smart-contract", "on-chain", ...(Array.isArray(item.tags) ? item.tags : [])],
      status: "open",
      createdAt: item.createdAt || new Date().toISOString(),
      network: "base",
      escrowAddress: item.escrowAddress || item.contractAddress,
    }));

    return filterBounties(parsed, options);
  } catch (error) {
    logger.warn("Failed to fetch Base on-chain escrows", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Fetch active bounties from Algora public API
 */
export async function fetchAlgoraBounties(options?: FetchBountiesOptions): Promise<BountyItem[]> {
  try {
    const limit = options?.limit ?? 10;
    const url = `https://console.algora.io/api/bounties?status=active&limit=${limit}`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      logger.warn(`Algora API responded with status ${response.status}`);
      return [];
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      logger.warn("Algora returned non-JSON response (endpoint deprecated/moved). Returning empty.");
      return [];
    }

    const data = await response.json() as any;
    const items = Array.isArray(data) ? data : data.items || data.bounties || [];

    const parsed: BountyItem[] = items.map((item: any) => {
      const rewardFormatted = item.amount || item.reward || item.reward_amount || 0;
      const rewardUsd = typeof rewardFormatted === "number" ? rewardFormatted : parseFloat(String(rewardFormatted)) || 0;

      return {
        id: `algora-${item.id || item.issue_id || Math.random().toString(36).substring(2)}`,
        source: "algora",
        title: item.title || item.issue_title || item.task || "Open Bounty",
        url: item.url || item.issue_url || item.html_url || "https://algora.io",
        rewardUsd,
        tags: Array.isArray(item.tags) ? item.tags : item.languages || ["code"],
        repo: item.repo || item.repository_name,
        issueNumber: item.issue_number || item.number,
        status: "open",
        createdAt: item.created_at || new Date().toISOString(),
      };
    });

    return filterBounties(parsed, options);
  } catch (error) {
    logger.warn("Failed to fetch Algora bounties", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Fetch active bounties from Bountycaster public API
 */
export async function fetchBountycasterBounties(options?: FetchBountiesOptions): Promise<BountyItem[]> {
  try {
    const url = "https://api.bountycaster.xyz/bounties/open";
    const response = await fetch(url, {
      headers: {
        "Accept": "*/*",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as any;
    const items = Array.isArray(data) ? data : data.bounties || data.items || [];

    const parsed: BountyItem[] = items.map((item: any) => ({
      id: `bountycaster-${item.id || Math.random().toString(36).substring(2)}`,
      source: "bountycaster",
      title: item.title || item.text || item.summary || "Bountycaster Task",
      url: item.url || item.link || "https://bountycaster.xyz",
      rewardUsd: parseFloat(String(item.amountUsd || item.amount || 0)) || 0,
      tags: Array.isArray(item.tags) ? item.tags : ["data", "script"],
      status: "open",
      createdAt: item.createdAt || new Date().toISOString(),
    }));

    return filterBounties(parsed, options);
  } catch (error) {
    logger.warn("Failed to fetch Bountycaster bounties", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

function filterBounties(items: BountyItem[], options?: FetchBountiesOptions): BountyItem[] {
  let result = items;
  if (options?.minRewardUsd !== undefined) {
    result = result.filter(b => b.rewardUsd >= options.minRewardUsd!);
  }
  if (options?.maxRewardUsd !== undefined) {
    result = result.filter(b => b.rewardUsd <= options.maxRewardUsd!);
  }
  if (options?.tag) {
    const tagLower = options.tag.toLowerCase();
    result = result.filter(b => 
      b.tags.some(t => t.toLowerCase().includes(tagLower)) ||
      b.title.toLowerCase().includes(tagLower)
    );
  }
  return result;
}

/**
 * Unified fetcher across all supported sources
 */
export async function fetchAllBounties(options?: FetchBountiesOptions): Promise<BountyItem[]> {
  const source = options?.source ?? "all";
  let results: BountyItem[] = [];

  if (source === "github" || source === "all") {
    const github = await fetchGitHubBounties(options);
    results = results.concat(github);
  }

  if (source === "algora" || source === "all") {
    const algora = await fetchAlgoraBounties(options);
    results = results.concat(algora);
  }

  if (source === "bountycaster" || source === "all") {
    const bc = await fetchBountycasterBounties(options);
    results = results.concat(bc);
  }

  if (source === "base_onchain" || source === "all") {
    const onchain = await fetchBaseEscrows(options);
    results = results.concat(onchain);
  }

  return results.sort((a, b) => b.rewardUsd - a.rewardUsd);
}

/**
 * Deep inspection of a specific bounty URL/issue
 */
export async function inspectBountyDetails(url: string): Promise<{
  title: string;
  description: string;
  acceptanceCriteria?: string;
  testInstructions?: string;
}> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Lakshmi-Automaton/1.0" },
    });
    if (!res.ok) {
      return {
        title: "Bounty Target",
        description: `Failed to fetch URL ${url} (HTTP ${res.status})`,
      };
    }
    const html = await res.text();
    // Clean preview
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);

    return {
      title: "Bounty Specifications",
      description: cleanText,
    };
  } catch (err: any) {
    return {
      title: "Bounty Target",
      description: `Error inspecting bounty: ${err.message}`,
    };
  }
}
