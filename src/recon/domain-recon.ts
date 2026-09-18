/**
 * Domain & Infrastructure OSINT Engine
 *
 * Inspired by MaxIntel methodologies:
 * 1. DNS-over-HTTPS (DoH) queries (A, AAAA, MX, TXT) via public DoH (Google/Cloudflare).
 * 2. Certificate Transparency log scanning via crt.sh for passive subdomain enumeration.
 * 3. Email security hygiene evaluation (SPF and DMARC validation).
 *
 * Operates with zero third-party API keys and zero OS-level socket dependencies.
 */

import { createLogger } from "../observability/logger.js";

const logger = createLogger("domain-recon");

export interface DnsRecord {
  name: string;
  type: number | string;
  data: string;
  TTL?: number;
}

export interface DomainReconReport {
  domain: string;
  queriedAt: string;
  ipAddresses: string[];
  mailServers: string[];
  spfConfigured: boolean;
  dmarcConfigured: boolean;
  subdomains: string[];
  securityScore: number; // 0 to 100
  securityNotes: string[];
}

/**
 * Perform DNS-over-HTTPS query using Google Public DNS
 */
export async function queryDoh(name: string, type: string = "A"): Promise<DnsRecord[]> {
  try {
    const url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json", "User-Agent": "Lakshmi-OSINT/1.0" },
    });
    if (!res.ok) return [];
    const json = await res.json() as any;
    if (!json.Answer || !Array.isArray(json.Answer)) return [];

    return json.Answer.map((ans: any) => ({
      name: ans.name,
      type: ans.type,
      data: ans.data,
      TTL: ans.TTL,
    }));
  } catch (err: any) {
    logger.debug(`DoH query failed for ${name} (${type}): ${err.message}`);
    return [];
  }
}

/**
 * Passive subdomain enumeration via public Certificate Transparency (crt.sh)
 */
export async function queryCertificateTransparency(domain: string): Promise<string[]> {
  try {
    const cleanDomain = domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
    const url = `https://crt.sh/?q=%.${encodeURIComponent(cleanDomain)}&output=json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout for crt.sh

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Lakshmi-Recon/1.0",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const entries = await res.json() as any[];
    if (!Array.isArray(entries)) return [];

    const subdomains = new Set<string>();
    for (const entry of entries) {
      const nameValue = entry.name_value || entry.common_name;
      if (typeof nameValue === "string") {
        const names = nameValue.split("\n");
        for (const n of names) {
          const trimmed = n.trim().toLowerCase();
          if (trimmed.includes(cleanDomain) && !trimmed.startsWith("*.")) {
            subdomains.add(trimmed);
          }
        }
      }
    }

    return Array.from(subdomains).sort();
  } catch (err: any) {
    logger.debug(`Certificate Transparency lookup for ${domain} timed out or failed: ${err.message}`);
    return [];
  }
}

/**
 * Complete Domain & Infrastructure Reconnaissance
 */
export async function performDomainRecon(rawDomain: string): Promise<DomainReconReport> {
  const domain = rawDomain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0].trim();
  const securityNotes: string[] = [];

  // 1. Parallel DoH queries
  const [aRecords, mxRecords, txtRecords, dmarcRecords, subdomains] = await Promise.all([
    queryDoh(domain, "A"),
    queryDoh(domain, "MX"),
    queryDoh(domain, "TXT"),
    queryDoh(`_dmarc.${domain}`, "TXT"),
    queryCertificateTransparency(domain),
  ]);

  const ipAddresses = aRecords.map(r => r.data);
  const mailServers = mxRecords.map(r => r.data.replace(/^\d+\s+/, ""));

  // 2. Email security checks
  const spfRecord = txtRecords.find(r => r.data.includes("v=spf1"));
  const spfConfigured = !!spfRecord;
  const dmarcRecord = dmarcRecords.find(r => r.data.includes("v=DMARC1"));
  const dmarcConfigured = !!dmarcRecord;

  // 3. Score calculation
  let score = 50; // base score for resolving domain

  if (ipAddresses.length > 0) score += 10;
  if (ipAddresses.length > 1) {
    score += 5;
    securityNotes.push("Multiple A records configured for DNS redundancy.");
  } else {
    securityNotes.push("Single IP detected; no DNS-level failover observed.");
  }

  if (mailServers.length > 0) {
    score += 10;
    if (spfConfigured) {
      score += 15;
      securityNotes.push("SPF (Sender Policy Framework) record is active.");
    } else {
      securityNotes.push("Missing SPF record: domain vulnerable to spoofed outbound emails.");
    }

    if (dmarcConfigured) {
      score += 15;
      securityNotes.push("DMARC policy configured to protect email reputation.");
    } else {
      securityNotes.push("Missing DMARC policy: recommend adding TXT record for _dmarc.");
    }
  } else {
    score += 10;
    securityNotes.push("No MX records configured (non-mail domain).");
  }

  if (subdomains.length > 0) {
    securityNotes.push(`Discovered ${subdomains.length} public subdomains via Certificate Transparency.`);
  }

  return {
    domain,
    queriedAt: new Date().toISOString(),
    ipAddresses,
    mailServers,
    spfConfigured,
    dmarcConfigured,
    subdomains: subdomains.slice(0, 50), // Cap top 50 in report
    securityScore: Math.min(100, Math.max(0, score)),
    securityNotes,
  };
}
