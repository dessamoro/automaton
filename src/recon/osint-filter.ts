import { createLogger } from "../observability/logger.js";

const logger = createLogger("recon.osint-filter");

export interface OsintFilterOptions {
  maxTokens?: number;
  ignoreHosts?: string[];
  ignoreCodes?: number[];
}

// system-0: Deterministic counting, filtering, and summarization
export function filterOsintAnomalies(rawResults: any[], options: OsintFilterOptions = {}): string {
  const maxTokens = options.maxTokens || 1500;
  const ignoreCodes = new Set(options.ignoreCodes || [404, 403, 301, 302, 500, 502, 503]);
  const ignoreHosts = new Set((options.ignoreHosts || []).map(h => h.toLowerCase()));

  if (!Array.isArray(rawResults)) {
    return JSON.stringify(rawResults).slice(0, maxTokens * 3);
  }

  // Count items and group by status
  const total = rawResults.length;
  const statusCounts: Record<string, number> = {};
  
  // Keep anomalies
  const anomalies: any[] = [];

  for (const item of rawResults) {
    const statusStr = String(item.status || "unknown");
    statusCounts[statusStr] = (statusCounts[statusStr] || 0) + 1;

    // Is it anomalous? (e.g. status 200 and not in ignore list)
    const isSuccess = item.status === 200 || item.status === "200";
    const host = (item.host || item.url || "").toLowerCase();
    
    if (isSuccess && !ignoreHosts.has(host) && !ignoreCodes.has(Number(item.status))) {
      anomalies.push(item);
    }
  }

  // Cap anomalies to prevent token blowout
  // Heuristic: 1 item is roughly ~30 tokens, so max ~40 items for 1200 tokens
  const maxItems = Math.max(1, Math.floor((maxTokens * 0.8) / 30));
  const truncatedAnomalies = anomalies.slice(0, maxItems);

  const summary = {
    totalScanned: total,
    statusBreakdown: statusCounts,
    anomaliesFound: anomalies.length,
    anomaliesShown: truncatedAnomalies.length,
    anomalies: truncatedAnomalies,
  };

  logger.info(`OSINT Filter: scanned ${total}, found ${anomalies.length} anomalies`);
  
  return JSON.stringify(summary, null, 2);
}
