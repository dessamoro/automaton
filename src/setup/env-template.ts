/**
 * Environment Configuration Template
 *
 * Pre-configured for Sovereign / Self-Hosted operation, including
 * GitHub Student Developer Pack resources (DigitalOcean VPS, Cloudflare, GitHub Models).
 */

export const ENV_TEMPLATE = `# === Inference Providers ===
# Set the API key(s) for the providers you want to use.
# Only one is required. The routing matrix handles automatic fallback.

# Anthropic Claude
ANTHROPIC_API_KEY=

# OpenAI
OPENAI_API_KEY=

# GitHub Models (Free via GitHub Student Developer Pack / Personal Access Token)
# Base URL: https://models.inference.ai.azure.com
GITHUB_TOKEN=

# Ollama (Local free inference, e.g. "ollama run llama3.3:70b")
# OLLAMA_BASE_URL=http://localhost:11434

# === Compute Provider ===
# Options: "local" (default, zero extra software), "docker", "ssh", "conway"
COMPUTE_BACKEND=local

# If using Docker / Podman:
# DOCKER_CONTAINER=automaton-sandbox

# If using Remote VPS over SSH (e.g. DigitalOcean Droplet from Student Pack):
# SSH_HOST=your-droplet-ip.example.com
# SSH_USER=root
# SSH_PORT=22
# SSH_KEY_PATH=~/.ssh/id_ed25519

# === Budget Limits ===
# Monthly budget envelope in cents (e.g., 5000 = $50.00 / month)
MONTHLY_BUDGET_CENTS=5000
# Fixed server cost in cents (0 if using free DigitalOcean student credits)
VPS_COST_CENTS=0
`;
