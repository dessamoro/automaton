import type { AgentTurn } from "../types.js";

const READ_ONLY = /^\s*(ls|pwd|cat|head|tail|find|grep|rg|echo|whoami|env|printenv|df|du|ps|stat|wc|which|uname|date|git\s+(status|log|diff))\b/;

const MUTATING_TOOLS = new Set([
  "exec", "write_file", "edit_own_file", "transfer_credits", "topup_credits", "fund_child",
  "spawn_child", "start_child", "delete_sandbox", "create_sandbox",
  "install_npm_package", "install_mcp_server", "install_skill",
  "create_skill", "remove_skill", "install_skill_from_git",
  "install_skill_from_url", "pull_upstream", "git_commit", "git_push",
  "git_branch", "git_clone",
  "register_domain", "register_erc8004", "give_feedback",
  "update_genesis_prompt", "update_agent_card", "modify_heartbeat",
  "expose_port", "remove_port", "x402_fetch", "manage_dns",
  "distress_signal", "prune_dead_children",
  "set_goal", "complete_goal", "save_procedure",
  "enter_low_compute", "switch_model", "review_upstream_changes",
]);

export class IdleDetector {
  private unproductiveTurns = 0;
  private initialized = false;
  private lastTaskId: string | null = null;
  private lastGoalId: string | null = null;
  private history: string[] = [];
  
  private backoffLevel = 0;
  
  constructor(
    private readonly config: {
      maxUnproductiveTurns: number;
      warnAfterTurns: number;
      baseBackoffMs: number;
      maxBackoffMs: number;
    } = { maxUnproductiveTurns: 5, warnAfterTurns: 3, baseBackoffMs: 30000, maxBackoffMs: 300000 }
  ) {}

  public getBackoffMs(): number {
    return Math.min(this.config.baseBackoffMs * Math.pow(2, this.backoffLevel), this.config.maxBackoffMs);
  }
  
  public checkProgress(turn: AgentTurn, currentTaskId: string | null, currentGoalId: string | null): number | null {
    const changed = this.initialized &&
      (currentTaskId !== this.lastTaskId || currentGoalId !== this.lastGoalId);
    this.initialized = true;
    this.lastTaskId = currentTaskId;
    this.lastGoalId = currentGoalId;

    let hasProgress = false;

    // Checking if any tool call modified state or indicated completion/rest
    for (const call of turn.toolCalls) {
      if (call.name === "sleep" || call.name === "complete_task") {
        hasProgress = true;
      }
      
      if (MUTATING_TOOLS.has(call.name)) {
        if (call.name === "exec") {
          const args = (call as any).args ?? (call as any).arguments;
          if (!READ_ONLY.test(String(args?.command ?? ""))) {
            hasProgress = true;
          }
        } else {
          hasProgress = true;
        }
      }
    }
    
    // Repetition detection: same tool+args in 3 of the last 4 turns => not progress
    const currentSignature = turn.toolCalls.map(c => {
      const args = ((c as any).args ?? (c as any).arguments) || {};
      return `${c.name}:${JSON.stringify(args)}`;
    }).join('|');
    
    this.history.push(currentSignature);
    if (this.history.length > 4) {
      this.history.shift();
    }
    if (this.history.filter(s => s === currentSignature).length >= 3) {
      hasProgress = false;
    }
    
    // Changing tasks or goals ALWAYS counts as progress, overriding repetition
    if (changed) {
      hasProgress = true;
    }

    if (hasProgress) {
      this.unproductiveTurns = 0;
      this.backoffLevel = 0;
      return null;
    } else {
      this.unproductiveTurns++;
      if (this.unproductiveTurns >= this.config.maxUnproductiveTurns) {
        const ms = this.getBackoffMs();
        this.backoffLevel++;
        this.unproductiveTurns = 0;
        return ms;
      }
      return null;
    }
  }
  
  public getWarningDirective(): string | null {
    if (this.unproductiveTurns >= this.config.warnAfterTurns && this.unproductiveTurns < this.config.maxUnproductiveTurns) {
      if (this.lastTaskId) {
        return "CRITICAL WARNING: Unproductive idle behavior detected. You are wasting compute budget. Immediately execute the assigned task, make stateful progress, or use sleep/complete_task.";
      } else {
        return "CRITICAL WARNING: Unproductive idle behavior detected. You are wasting compute budget. You have no task assigned. Use sleep or make stateful progress.";
      }
    }
    return null;
  }
}
