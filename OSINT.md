# OSINT Intelligence Playbook for Lakshmi

> **Automaton Autonomous Reconnaissance, Investigation & Verification Protocol**  
> **Classification**: Sovereign Intelligence Operating Procedure  
> **Runtime Target**: Lakshmi (Conway Automaton Sovereign Agent)

---

## 1. Operating Doctrine & Agent Instructions

When conducting intelligence collection or fulfilling paid reconnaissance tasks (`domain_recon`, `repo_recon`, `security_audit`, or investigative missions):

1. **Verify Before Action**: Never rely on a single source. Cross-reference across network, archive, and open web data.
2. **Deterministic Preservation**: Log raw outputs, timestamps, and hashes into `.sandbox/recon/` before synthesizing findings.
3. **Structured Reporting**: Output final intelligence briefs using the standardized OSINT Report Template in Section 10.
4. **Admiralty Grading**: Rate both Source Reliability (A–F) and Information Credibility (1–6).

---

## 1.1 OpenOSINT Engine & Native MCP Integration

Lakshmi integrates with the [OpenOSINT](https://github.com/OpenOSINT/OpenOSINT) framework (MIT), an autonomous 20-tool intelligence agent that exposes real binaries and deterministic outputs through CLI and Model Context Protocol (MCP).

### Setup in Codespaces / Host
```bash
pip install openosint
```

### Native MCP Server Configuration (`openosint mcp`)
Any MCP-compatible client (Antigravity IDE, Claude Code, OpenCode) can expose all 20 tools directly:
```json
{
  "mcpServers": {
    "openosint": {
      "command": "openosint",
      "args": ["mcp"]
    }
  }
}
```

### Direct Tool Execution via Lakshmi `exec`
Lakshmi can invoke the 20 specialized OpenOSINT tools directly:
* **Account & Profile Discovery**: `openosint username <handle>` (Sherlock over 400+ platforms)
* **Email Exposure**: `openosint email <email>` (Holehe registration enumeration)
* **Breach Intel**: `openosint breach <email>` (HaveIBeenPwned API)
* **Domain & DNS**: `openosint dns <domain>` / `openosint whois <domain>`
* **Infrastructure**: `openosint ip <ip>` / `openosint shodan <ip>` / `openosint censys <query>`
* **Malware & Reputation**: `openosint virustotal <target>` / `openosint abuseipdb <ip>`
* **Automated Dorking**: `openosint dorks <target>` (Generates 12 targeted dork URLs)

---

## 2. Network Intelligence

Gather infrastructure, routing, and hosting telemetry using local toolchain (`dig`, `whois`, `curl`, Python).

### Methodology & Vectors
* **IP & Geolocation**: Map public IPs to physical locations, hosting providers, and datacenters.
* **Autonomous System (AS) Information**: Identify ASN ownership, peering, and multi-homed infrastructures.
* **BGP Routing Data**: Detect route anomalies, hijacked prefixes, and upstream transit providers.
* **Exposed Services & Perimeter**: Scan open ports, banners, TLS certificates, and IoT assets via Shodan, Censys, and Project Discovery tools.

### Autonomous Command Recipes (Lakshmi `exec`)
```bash
# DNS enumeration (A, MX, TXT, NS, CAA)
dig +noall +answer example.com ANY

# Trace ASN and IP allocation details
whois -h whois.radb.net -- "-i origin AS13335"

# TLS certificate transparency logs (crt.sh)
curl -s "https://crt.sh/?q=%25.example.com&output=json" | jq -r '.[].name_value' | sort -u

# Subdomain discovery via DNS brute/recon
python3 -c '
import urllib.request, json
url = "https://crt.sh/?q=%.target.com&output=json"
req = urllib.request.Request(url, headers={"User-Agent": "Lakshmi-OSINT/1.0"})
try:
    data = json.loads(urllib.request.urlopen(req, timeout=10).read())
    subdomains = sorted(set(entry["name_value"] for entry in data))
    for s in subdomains: print(s)
except Exception as e: print(f"Error: {e}")
'
```

---

## 3. Document & Leak Intelligence

Locate institutional records, whitepapers, leaked filings, and technical specifications.

### Sources & Repositories
* **Leaked Documents**: WikiLeaks, SecureDrop public releases, Distributed Denial of Secrets (DDoSecrets).
* **Government & Legal Records**: FOIA reading rooms, SEC EDGAR (10-K, 8-K), Swedish procurement (Offentlig upphandling), EU TED portal.
* **Academic & Technical Papers**: arXiv, Semantic Scholar, IEEE Xplore, Google Scholar.
* **Corporate Disclosures**: ESG reports, patent registries (WIPO, Google Patents), investor slide decks.

---

## 4. Google Dorking & Search Operands

Use targeted Boolean search operators to uncover misconfigured assets, sensitive disclosures, and index pages:

| Dork Operator | Purpose | Example Query |
| :--- | :--- | :--- |
| `site:` | Restrict search to domain or TLD | `site:gov.se "contract award"` |
| `filetype:` / `ext:` | Search specific file extensions | `filetype:pdf "annual report" Sweden` |
| `intitle:` | Words in the HTML page title | `intitle:"index of" procurement` |
| `inurl:` | Terms appearing in the path/URL | `inurl:admin site:example.com` |
| `cache:` | Snapshot of indexed page | `cache:example.com/sensitive-page` |
| Combined | Secret leak & credential search | `site:github.com "BEGIN PRIVATE KEY" OR "api_key"` |

---

## 5. Social Media & Entity Investigation

Profile individuals, organizations, and networks across decentralized and centralized platforms.

* **Twitter / X Advanced Search**:
  * Date bounded: `from:username since:2024-01-01 until:2024-12-31`
  * Engagement filters: `topic min_retweets:100 min_faves:500`
* **Professional & Developer Footprints**:
  * GitHub commits, Gists, PGP key signatures, and SSH key fingerprints (`https://github.com/<username>.keys`).
  * LinkedIn organizational structures and departures.
* **Community Archives**:
  * Reddit Pushshift archives, Telegram channel searches (via Telepathy or web scrapers).

---

## 6. Verification & Forensic Analysis

Every artifact collected must undergo technical authenticity testing before being cited.

### Image & Media Forensics
1. **Reverse Image Search**: TinEye API, Google Vision, Yandex Visual Search.
2. **EXIF Metadata**: Extract GPS coordinates, camera serial, software edits via `exiftool` / Python `PIL`.
3. **Error Level Analysis (ELA)**: Detect resaved layers, synthetic splice marks, and compression artifacts.

### Account Verification Matrix
* **Creation Timestamp**: Check UNIX timestamp against historical service milestones.
* **Cross-Platform Handle Parity**: Check handle reuse across Keybase, GitHub, Mastodon, X, Telegram.
* **Behavioral Rhythm**: Graph active posting hours to calculate likely timezone.

### Document Forensics
* Extract internal metadata: Author name, creation software, revision count, original file path:
```bash
# Python PDF Metadata Inspector
python3 -c '
from pypdf import PdfReader
reader = PdfReader(".sandbox/doc.pdf")
print("Meta:", reader.metadata)
'
```

---

## 7. Network & Chronological Mapping

Transform unstructured entities into relational graphs and timelines.

### Relational Network Mapping
* **Entities**: Nodes (Person, Organization, Server, Wallet, Domain).
* **Edges**: Relationships (`CONTROLS`, `TRANSFERS_FUNDS_TO`, `RESOLVES_TO`, `COMMUNICATES_WITH`).
* **Tooling Formats**: Export graph data to JSON-LD, Graphviz DOT, or Gephi CSV format.

### Chronological Timeline Construction
* Order all confirmed events monotonically (`YYYY-MM-DDTHH:MM:SSZ`).
* Identify **temporal anomalies**: Gaps in communication, abrupt velocity changes, simultaneous transactions across geographically impossible regions.

---

## 8. Behavioral Pattern & Anomaly Detection

1. **Pattern of Life (PoL)**: Baseline standard operating hours, communication frequency, and transaction sizes.
2. **Break in Pattern**:
   * Sudden cessation of activity after a major public event.
   * Transfer of assets or migration of DNS servers during off-hours.
   * Signature changes in commit history (different GPG keys or commit author email mismatch).

---

## 9. Intelligence Collection Record

Lakshmi must maintain a collection log in `.sandbox/recon/collection_record.jsonl`:

```json
{
  "timestamp": "2026-09-19T06:50:00Z",
  "source_url": "https://example.com/report.pdf",
  "preservation_hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "preservation_path": ".sandbox/recon/raw/report.pdf",
  "search_query": "site:example.com filetype:pdf",
  "initial_assessment": "Official financial statement 2025 containing audited expenditure tables",
  "reliability_score": "B2"
}
```

---

## 10. Standardized OSINT Report Template

Output all completed intelligence products using this markdown schema:

```markdown
# OSINT Report: [Target / Topic]

**Classification**: Public / Internal / Confidential  
**Date**: [YYYY-MM-DD]  
**Analyst**: Lakshmi (Conway Sovereign Automaton)  
**Verification Level**: Admiralty B2 (High Confidence)

---

## Executive Summary
[2-3 paragraph executive briefing detailing the most critical discoveries, attribution, and risks]

## Intelligence Requirements
- [Core question 1]
- [Core question 2]

## Methodology & Sources
- **Network Telemetry**: DNS, BGP, TLS certificate transparency logs
- **Open Web / Dorking**: Targeted search syntax, document archives
- **Tools Used**: `dig`, `whois`, custom Python recon scripts
- **Time Period**: [Date range examined]
- **Identified Limitations**: [Inaccessible paywalls, rate limits, unverified claims]

## Key Findings

### Finding 1: [Descriptive Finding Title]
* **Confidence Level**: High / Medium / Low
* **Evidence**: [Concrete evidence, file hashes, timestamps, URLs]
* **Analysis**: [Technical breakdown and meaning of the finding]

### Finding 2: [Descriptive Finding Title]
* **Confidence Level**: High / Medium / Low
* **Evidence**: [Concrete evidence, data points]
* **Analysis**: [Contextual evaluation]

## Assessment & Strategic Implications
[Synthesis of how the findings fit together, threat landscape, organizational exposure, or market impact]

## Recommendations
1. **Immediate**: [Actionable technical or security recommendation]
2. **Medium-Term**: [Monitoring or architectural improvement]

---

## Appendices
* **Appendix A: Source Registry & Archive Hashes**
* **Appendix B: Raw DNS & Infrastructure Dumps**
* **Appendix C: Artifact Inventory**
```
