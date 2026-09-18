#!/usr/bin/env bash
# seed-skills.sh
# Seeds starter skills into ~/.automaton/skills/ for Lakshmi to load on next wake.
# Run this once in your Codespace: bash src/seed-skills.sh

set -e

SKILLS_BASE="${HOME:-$USERPROFILE}/.automaton/skills"
echo "Seeding starter skills into ${SKILLS_BASE}..."
mkdir -p "${SKILLS_BASE}"

# ─── Skill 1: local-environment ───────────────────────────────────────────────
mkdir -p "${SKILLS_BASE}/local-environment"
cat > "${SKILLS_BASE}/local-environment/SKILL.md" << 'SKILL'
---
name: local-environment
description: Understanding the local Codespaces execution environment and file system layout
tier: core
max-tokens: 250
---

# Local Environment Guide

You are running inside a GitHub Codespaces container as user `codespace`, NOT as `root`.

## Key Facts

- Your working directory is typically `/workspaces/Antigravity/automaton`
- Your sandbox directory is `.sandbox/` inside the working directory (e.g., `/workspaces/Antigravity/automaton/.sandbox/`)
- Do NOT write files to `/root/...` — you do not have permission there
- Use **relative paths** or paths under `.sandbox/`: write to `agent_service.py` (not `/root/agent_service.py`)
- Check who you are: `exec({"command": "whoami"})` → should return `codespace`
- Check your working directory: `exec({"command": "pwd"})`

## File Writing Rules

- Correct: `write_file({"path": "agent_service.py", ...})` → goes to `.sandbox/agent_service.py`
- Correct: `write_file({"path": ".sandbox/server.py", ...})`
- WRONG: `write_file({"path": "/root/agent_service.py", ...})` → EACCES permission denied

## Environment Variables & Runtime

- `HOME = /home/codespace`
- `USER = codespace`
- Python 3 is available: `python3 --version`
- Node 22 is available

## After Writing a File

Always verify with: `exec({"command": "ls -la .sandbox/"})`
SKILL

# ─── Skill 2: microservice-builder ────────────────────────────────────────────
mkdir -p "${SKILLS_BASE}/microservice-builder"
cat > "${SKILLS_BASE}/microservice-builder/SKILL.md" << 'SKILL'
---
name: microservice-builder
description: Build and expose a minimal HTTP micro-service on port 8080 using Python or Node
tier: contextual
max-tokens: 300
---

# Microservice Builder

## Minimal Python HTTP Server (Recommended)

Write this to `.sandbox/server.py`:

```python
import http.server
import socketserver
import json

PORT = 8080

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "alive"}).encode())
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, format, *args):
        pass  # suppress logs

with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    httpd.serve_forever()
```

## Steps

1. `write_file({"path": "server.py", "content": "...above code..."})`
2. `exec({"command": "python3 .sandbox/server.py &", "timeout": 3000})` (runs in background)
3. `exec({"command": "curl -s http://localhost:8080/health"})` (verify it works)
4. `expose_port({"port": 8080})` (get the public URL)

## Common Mistakes to Avoid

- Do NOT use `socketserver.TCPServer(("localhost", PORT), ...)` — use `"0.0.0.0"` to be reachable
- Do NOT bind to port 80 or 443 — use 8080 or 8000
- Always test with curl BEFORE calling `expose_port`
SKILL

# ─── Skill 3: ask-oracle-guide ────────────────────────────────────────────────
mkdir -p "${SKILLS_BASE}/ask-oracle-guide"
cat > "${SKILLS_BASE}/ask-oracle-guide/SKILL.md" << 'SKILL'
---
name: ask-oracle-guide
description: When and how to ask your human operator for help using the ask_oracle tool
tier: core
max-tokens: 200
---

# Oracle Tool Guide

You have access to `ask_oracle` — a direct line to your human operator.

## When to Use It

Use `ask_oracle` when:
- You have tried the same approach **more than twice** and keep getting the same error
- You are missing a credential, API key, or permission you cannot obtain yourself
- You need to make an irreversible decision (e.g., spending money, deleting data)
- You are genuinely confused about what your next goal should be

Do NOT use `ask_oracle`:
- For things you can figure out with `exec("...")` or `web_fetch`
- As your first response to a problem — try at least once yourself first
- Repeatedly for the same question you already asked (wait for inbox response)

## How to Write a Good Question

```json
ask_oracle({
  "question": "I cannot write files to /root/ — what directory should I use?",
  "context": "I tried write_file({'path': '/root/server.py', ...}) twice and got EACCES permission denied each time."
})
```

Be specific:
- State what tool you called and its exact arguments
- State the exact error message you received
- State what you were trying to achieve

## After Calling ask_oracle

- Record in your reasoning that you are waiting for an oracle response
- Sleep briefly or work on a different independent task
- The response will arrive in your inbox as `[Oracle Response]: ...`
- When you see it, use it to unblock yourself and continue
SKILL

# ─── Skill 4: error-recovery ──────────────────────────────────────────────────
mkdir -p "${SKILLS_BASE}/error-recovery"
cat > "${SKILLS_BASE}/error-recovery/SKILL.md" << 'SKILL'
---
name: error-recovery
description: Protocol for recovering from permission errors, missing tools, and stuck loops
tier: core
max-tokens: 200
---

# Error Recovery Protocol

When an action fails, follow this triage order:

1. **Permission Denied (EACCES)**:
   - Check where you are: `exec({"command": "pwd"})`
   - Check who you are: `exec({"command": "whoami"})`
   - Never write to `/root/` or absolute system paths. Always use relative paths like `server.py` or `.sandbox/server.py`.
2. **Unknown Tool**:
   - If a tool fails with "Unknown tool", do NOT retry calling it.
   - Use standard tools: `exec`, `read_file`, `write_file`, `http_request`.
3. **Looping / Blocked**:
   - If you tried twice and failed, STOP.
   - Do NOT try a 3rd identical attempt.
   - Call `ask_oracle` with the exact error and what you attempted.
SKILL

echo "Skills seeded successfully into ${SKILLS_BASE}!"
ls -la "${SKILLS_BASE}"
