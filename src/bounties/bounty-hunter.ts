/**
 * Bounty Hunter Service
 *
 * Discovers and inspects active developer bounties from Algora and Bountycaster.
 */

import { createLogger } from "../observability/logger.js";

const logger = createLogger("bounties");

export interface BountyItem {
  id: string;
  source: "algora" | "bountycaster" | "github";
  title: string;
  url: string;
  rewardUsd: number;
  tags: string[];
  repo?: string;
  issueNumber?: number;
  status: "open" | "in_progress" | "completed";
  createdAt?: string;
}

export interface FetchBountiesOptions {
  source?: "algora" | "bountycaster" | "all";
  minRewardUsd?: number;
  maxRewardUsd?: number;
  tag?: string;
  limit?: number;
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
        "Accept": "*/*",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      logger.warn(`Algora API responded with status ${response.status}`);
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
    logger.warn("Failed to fetch Algora bounties", error instanceof Error ? error : undefined);
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
    logger.warn("Failed to fetch Bountycaster bounties", error instanceof Error ? error : undefined);
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

  if (source === "algora" || source === "all") {
    const algora = await fetchAlgoraBounties(options);
    results = results.concat(algora);
  }

  if (source === "bountycaster" || source === "all") {
    const bc = await fetchBountycasterBounties(options);
    results = results.concat(bc);
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
