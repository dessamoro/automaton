---
name: osint-investigator
description: Autonomous open-source intelligence gathering, verification, and reporting protocol
tier: specialized
max-tokens: 450
---

# OSINT Intelligence Protocol

When conducting intelligence gathering, domain/repo recon, or verification:

1. **Operating Guidelines**: Full playbook is at `OSINT.md` in the project root. Read it if deep methodology is needed.
2. **Native Recon Tools**:
   - `domain_recon({"domain": "target.com"})`: Automated DoH DNS, crt.sh subdomains, SPF/DMARC hygiene, and OpenRDAP registrar report.
   - `check_counterparty({"address": "0x..."})`: Verify wallet transaction history, balance, and chain status before accepting tasks.
3. **OpenOSINT & CLI Pipelines**: Run `openosint --json <tool>` or `subfinder | httpx` via `exec` for deterministic data.
4. **Verification**: Never rely on a single source. Cross-reference across network, archive, and open web data.
5. **Collection Record**: Save raw artifacts and hashes to `.sandbox/recon/`.
6. **Structured Delivery**: Format final reports using the standard schema in `OSINT.md` with Admiralty Confidence Ratings (High/Medium/Low).
