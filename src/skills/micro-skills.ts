/**
 * Micro-skills Boot Seeder
 *
 * Embeds starter micro-skills as compile-time constants so Lakshmi
 * is never dependent on external bash scripts being manually run.
 * At boot, if ~/.automaton/skills/ is empty or missing, this module
 * automatically seeds the micro-skills to disk.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("skills.micro");

export interface EmbeddedMicroSkill {
  dirName: string;
  skillMd: string;
}

export const EMBEDDED_STARTER_SKILLS: EmbeddedMicroSkill[] = [
  {
    dirName: "local-environment",
    skillMd: `---
name: local-environment
description: Understanding the local Codespaces execution environment and file system layout
tier: core
max-tokens: 250
---

# Local Environment Guide

You are running inside a GitHub Codespaces container as user \`codespace\`, NOT as \`root\`.

## Key Facts

- Your working directory is typically \`/workspaces/Antigravity/automaton\`
- Your sandbox directory is \`.sandbox/\` inside the working directory (e.g., \`/workspaces/Antigravity/automaton/.sandbox/\`)
- Do NOT write files to \`/root/...\` — you do not have permission there
- Use **relative paths** or paths under \`.sandbox/\`: write to \`agent_service.py\` (not \`/root/agent_service.py\`)
- Check who you are: \`exec({"command": "whoami"})\` → returns \`codespace\`
- Check your working directory: \`exec({"command": "pwd"})\`

## File Writing Rules

- Correct: \`write_file({"path": "agent_service.py", ...})\` → writes to \`.sandbox/agent_service.py\`
- Correct: \`write_file({"path": ".sandbox/server.py", ...})\`
- WRONG: \`write_file({"path": "/root/agent_service.py", ...})\` → EACCES permission denied

## Environment Variables & Runtime

- \`HOME = /home/codespace\`
- \`USER = codespace\`
- Python 3 is available: \`python3 --version\`
- Node 22 is available

## After Writing a File

Always verify with: \`exec({"command": "ls -la .sandbox/"})\`
`,
  },
  {
    dirName: "microservice-builder",
    skillMd: `---
name: microservice-builder
description: Build and expose a minimal HTTP micro-service on port 8080 using Python or Node
tier: contextual
max-tokens: 300
---

# Microservice Builder

## Minimal Python HTTP Server (Recommended)

Write this to \`.sandbox/server.py\`:

\`\`\`python
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
        pass

with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    httpd.serve_forever()
\`\`\`

## Steps

1. \`write_file({"path": "server.py", "content": "...above code..."})\`
2. \`exec({"command": "python3 .sandbox/server.py &", "timeout": 3000})\`
3. \`exec({"command": "curl -s http://localhost:8080/health"})\`
4. \`expose_port({"port": 8080})\`

## Common Mistakes to Avoid

- Do NOT use \`socketserver.TCPServer(("localhost", PORT), ...)\` — use \`"0.0.0.0"\`
- Do NOT bind to port 80 or 443 — use 8080 or 8000
- Always test with curl BEFORE calling expose_port
`,
  },
  {
    dirName: "ask-oracle-guide",
    skillMd: `---
name: ask-oracle-guide
description: When and how to ask your human operator for help using the ask_oracle tool
tier: core
max-tokens: 200
---

# Oracle Tool Guide

You have access to \`ask_oracle\` — a direct line to your human operator.

## When to Use It

Use \`ask_oracle\` when:
- You have tried the same approach **more than twice** and keep getting the same error
- You are missing a credential, API key, or permission you cannot obtain yourself
- You need to make an irreversible decision (e.g., spending money, deleting data)
- You are genuinely confused about what your next goal should be

Do NOT use \`ask_oracle\`:
- For things you can figure out with \`exec("...")\` or \`web_fetch\`
- As your first response to a problem — try at least once yourself first
- Repeatedly for the same question you already asked (wait for inbox response)

## How to Write a Good Question

\`\`\`json
ask_oracle({
  "question": "I cannot write files to /root/ — what directory should I use?",
  "context": "I tried write_file({'path': '/root/server.py', ...}) twice and got EACCES permission denied each time."
})
\`\`\`

Be specific:
- State what tool you called and its exact arguments
- State the exact error message you received
- State what you were trying to achieve

## After Calling ask_oracle

- Record in your reasoning that you are waiting for an oracle response
- Sleep briefly or work on a different independent task
- The response will arrive in your inbox as \`[Oracle Response]: ...\`
- When you see it, use it to unblock yourself and continue
`,
  },
  {
    dirName: "error-recovery",
    skillMd: `---
name: error-recovery
description: Protocol for recovering from permission errors, missing tools, and stuck loops
tier: core
max-tokens: 200
---

# Error Recovery Protocol

When an action fails, follow this triage order:

1. **Permission Denied (EACCES)**:
   - Check where you are: \`exec({"command": "pwd"})\`
   - Check who you are: \`exec({"command": "whoami"})\`
   - Never write to \`/root/\` or absolute system paths. Always use relative paths like \`server.py\` or \`.sandbox/server.py\`.
2. **Unknown Tool**:
   - If a tool fails with "Unknown tool", do NOT retry calling it.
   - Use standard tools: \`exec\`, \`read_file\`, \`write_file\`, \`http_request\`.
3. **Looping / Blocked**:
   - If you tried twice and failed, STOP.
   - Do NOT try a 3rd identical attempt.
   - Call \`ask_oracle\` with the exact error and what you attempted.
`,
  },
  {
    dirName: "bounty-hunter",
    skillMd: `---
name: bounty-hunter
description: Autonomous discovery and execution of Algora and Bountycaster paid developer tasks
tier: specialized
max-tokens: 400
---

# Bounty Hunter Protocol

You can discover, inspect, and claim active developer bounties to generate external revenue.

## Workflow

1. **Find Bounties**: Call \`fetch_bounties({ source: "all", tag: "typescript" })\` to see open tasks.
2. **Inspect & Evaluate**: Call \`inspect_bounty({ url: "..." })\` to read issue specifications.
3. **Budget Discipline**: Never accept a task if compute token cost exceeds 20% of the reward.
4. **Deterministic Verification**: Write the fix and run tests locally (\`npm test\` or \`pytest\`).
5. **Report & Deliver**: Output the verified solution or git branch.
`,
  },
];

/**
 * Ensures starter skills exist on disk at `resolvedDir`.
 * If directory is missing or empty, writes embedded skills.
 */
export function ensureBootMicroSkills(resolvedDir: string): void {
  try {
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }

    const existingEntries = fs.readdirSync(resolvedDir, { withFileTypes: true });
    const existingDirs = existingEntries.filter((e) => e.isDirectory());

    // If there are no skill directories, seed all embedded micro-skills
    if (existingDirs.length === 0) {
      logger.info(`Seeding ${EMBEDDED_STARTER_SKILLS.length} boot micro-skills into ${resolvedDir}`);
      for (const skill of EMBEDDED_STARTER_SKILLS) {
        const targetDir = path.join(resolvedDir, skill.dirName);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, "SKILL.md"), skill.skillMd, "utf-8");
      }
    }
  } catch (err: any) {
    logger.warn(`Failed to auto-seed boot micro-skills: ${err.message}`);
  }
}
