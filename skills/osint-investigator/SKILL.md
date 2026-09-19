---
name: osint-investigator
description: Autonomous open-source intelligence gathering, verification, and reporting protocol
tier: specialized
max-tokens: 450
---

# OSINT Intelligence Protocol

When conducting intelligence gathering, domain/repo recon, or verification:

1. **Operating Guidelines**: Full playbook is at `OSINT.md` in the project root. Read it if deep methodology is needed.
2. **Network Recon**: Use `dig`, `whois`, or crt.sh API via `exec` to map DNS, ASN, subdomains, and certificates.
3. **Google Dorking**: Formulate precise search syntax (`site:`, `filetype:pdf`, `inurl:`, `intitle:`).
4. **Verification**: Never rely on a single source. Check EXIF metadata, creation dates, cross-platform handles.
5. **Collection Record**: Save raw artifacts and hashes to `.sandbox/recon/`.
6. **Structured Delivery**: Format final reports using the standard schema in `OSINT.md`:
   - Executive Summary
   - Intelligence Requirements
   - Methodology & Tools
   - Key Findings (with Admiralty Confidence Rating: High/Medium/Low)
   - Assessment & Strategic Implications
   - Actionable Recommendations
