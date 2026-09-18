/**
 * Dynamic Toolset Manager (Phase 5)
 *
 * Implements tool surface reduction, shrinking the active tool schema
 * payload from 77 tools (~7,500 tokens) down to 6 core primitives
 * (~1,200 tokens) plus contextual skill modules on demand.
 */

import type { AutomatonTool } from "../types.js";

export const CORE_TOOL_NAMES = new Set([
  "exec",
  "read_file",
  "write_file",
  "http_request",
  "web_fetch",
  "x402_fetch",
  "db_query",
  "send_message",
  "discover_skills",
  "activate_skills",
  "ask_oracle",
  "fetch_bounties",
  "inspect_bounty",
]);

export interface SkillModule {
  name: string;
  description: string;
  toolNames: string[];
  keywords: string[];
}

export const SKILL_MODULES: Record<string, SkillModule> = {
  bounties: {
    name: "bounties",
    description: "Autonomous bounty discovery and inspection across Algora and Bountycaster",
    toolNames: ["fetch_bounties", "inspect_bounty"],
    keywords: ["bounty", "bounties", "job", "earn", "algora", "bountycaster", "work", "task", "revenue", "money"],
  },
  social: {
    name: "social",
    description: "Social communication and operator escalation: send messages, ask operator, post updates",
    toolNames: ["ask_oracle", "send_message", "social_post"],
    keywords: ["oracle", "human", "operator", "ask", "help", "message", "social", "post", "tweet"],
  },
  git: {
    name: "git",
    description: "Version control operations: git status, diff, commit, log, push, branch, clone",
    toolNames: ["git_status", "git_diff", "git_commit", "git_log", "git_push", "git_branch", "git_clone"],
    keywords: ["git", "commit", "diff", "branch", "repo", "push", "pull", "clone"],
  },
  self_mod: {
    name: "self_mod",
    description: "Code self-modification and package management with Nanoclaw safety invariants",
    toolNames: ["edit_own_file", "revert_last_edit", "reset_to_upstream", "install_npm_package"],
    keywords: ["edit_own_file", "modify code", "refactor", "install package", "npm"],
  },
  memory: {
    name: "memory",
    description: "Multi-tier memory: store facts, recall procedures, set goals, manage relationships",
    toolNames: [
      "remember_fact", "recall_facts", "forget_fact", "set_goal", "complete_goal",
      "save_procedure", "recall_procedure", "record_interaction",
    ],
    keywords: ["remember", "recall", "goal", "procedure", "fact", "memory"],
  },
  financial: {
    name: "financial",
    description: "Budget and wallet management: check spending, verify balance, send funds",
    toolNames: ["check_credits", "check_usdc_balance", "topup_credits", "transfer_credits"],
    keywords: ["credits", "balance", "wallet", "usdc", "transfer", "budget", "cost"],
  },
  replication: {
    name: "replication",
    description: "Multi-agent child spawning and constitutional verification",
    toolNames: ["spawn_child", "list_children", "fund_child", "check_child_status", "start_child"],
    keywords: ["child", "spawn", "replicate", "agent", "subagent", "delegate"],
  },
  soul: {
    name: "soul",
    description: "Soul self-reflection and narrative evolution",
    toolNames: ["update_soul", "reflect_on_soul", "view_soul", "view_soul_history"],
    keywords: ["soul", "reflect", "philosophy", "identity", "narrative"],
  },
  domains: {
    name: "domains",
    description: "Domain and DNS management",
    toolNames: ["search_domains", "register_domain", "list_dns_records", "add_dns_record", "delete_dns_record"],
    keywords: ["domain", "dns", "record", "hostname", "website"],
  },
  identity: {
    name: "identity",
    description: "On-chain identity and ERC-8004 agent discovery",
    toolNames: ["register_automaton", "register_erc8004", "update_agent_card", "discover_agents"],
    keywords: ["erc8004", "identity", "register", "discover_agents"],
  },
};

/**
 * Filter the flat 77-tool array down to the active set for this turn.
 */
export function getActiveToolsForTurn(
  allTools: AutomatonTool[],
  options?: {
    userPrompt?: string;
    explicitSkills?: string[];
    enableAllTools?: boolean;
  },
): AutomatonTool[] {
  if (options?.enableAllTools) {
    return allTools;
  }

  const prompt = (options?.userPrompt ?? "").toLowerCase();
  const activatedSkillNames = new Set<string>(options?.explicitSkills ?? []);

  // Auto-activate skills based on intent keywords in the turn's prompt
  for (const [skillId, module] of Object.entries(SKILL_MODULES)) {
    if (module.keywords.some(kw => prompt.includes(kw))) {
      activatedSkillNames.add(skillId);
    }
  }

  const allowedToolNames = new Set<string>(CORE_TOOL_NAMES);
  for (const skillId of activatedSkillNames) {
    const module = SKILL_MODULES[skillId];
    if (module) {
      for (const tName of module.toolNames) {
        allowedToolNames.add(tName);
      }
    }
  }

  // Filter existing tools
  const activeTools = allTools.filter(tool => allowedToolNames.has(tool.name));

  // Add meta-tools for dynamic skill discovery
  const hasDiscover = activeTools.some(t => t.name === "discover_skills");
  if (!hasDiscover) {
    activeTools.push(createDiscoverSkillsTool());
  }

  return activeTools;
}

function createDiscoverSkillsTool(): AutomatonTool {
  return {
    name: "discover_skills",
    description: "List available specialized skill modules (e.g. git, memory, soul, replication, domains) that can be activated when needed.",
    category: "skills",
    riskLevel: "safe",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const summary = Object.entries(SKILL_MODULES)
        .map(([id, mod]) => `• ${id}: ${mod.description} (Tools: ${mod.toolNames.join(", ")})`)
        .join("\n");
      return `Available skill modules:\n${summary}\n\nTo use tools from these modules, simply refer to them in your reasoning or request.`;
    },
  };
}
