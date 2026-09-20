import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("git.worktree");

export interface WorktreeResult {
  branch: string;
  path: string;
  success: boolean;
  output: string;
}

// system-0: Deterministic worktree management
export class GitWorktreeManager {
  constructor(private readonly repoRoot: string) {}

  /**
   * Creates a new isolated git worktree for speculative execution.
   */
  createWorktree(branchName: string, targetDirName?: string): string {
    const dirName = targetDirName || `worktree-${ulid()}`;
    const targetPath = path.resolve(this.repoRoot, ".worktrees", dirName);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    try {
      execSync(`git worktree add -b ${branchName} ${targetPath} HEAD`, {
        cwd: this.repoRoot,
        stdio: "pipe",
      });
      logger.info(`Created worktree for branch ${branchName} at ${targetPath}`);
      return targetPath;
    } catch (err: any) {
      logger.error(`Failed to create worktree: ${err.message}`);
      throw new Error(`Worktree creation failed: ${err.message}`);
    }
  }

  /**
   * Force removes a git worktree and deletes the branch.
   */
  removeWorktree(targetPath: string, branchName: string): void {
    try {
      if (fs.existsSync(targetPath)) {
        execSync(`git worktree remove --force ${targetPath}`, {
          cwd: this.repoRoot,
          stdio: "pipe",
        });
      }
      execSync(`git branch -D ${branchName}`, {
        cwd: this.repoRoot,
        stdio: "pipe",
      });
      logger.info(`Removed worktree at ${targetPath} and branch ${branchName}`);
    } catch (err: any) {
      logger.warn(`Cleanup failed for ${targetPath}: ${err.message}`);
    }
  }

  /**
   * Fast-forwards the current HEAD to the target branch.
   */
  mergeWinner(branchName: string): void {
    try {
      execSync(`git merge --ff-only ${branchName}`, {
        cwd: this.repoRoot,
        stdio: "pipe",
      });
      logger.info(`Merged winning branch ${branchName} into main`);
    } catch (err: any) {
      logger.error(`Failed to merge ${branchName}: ${err.message}`);
      throw new Error(`Merge failed: ${err.message}`);
    }
  }

  /**
   * Fans out a task across multiple branches and executes them.
   * Returns the first successful branch result, or the last failure if all fail.
   */
  async runSpeculativeExecution(
    branches: string[],
    executeFn: (worktreePath: string, branch: string) => Promise<void>,
    testCmd: string
  ): Promise<WorktreeResult | null> {
    const worktrees = branches.map((b) => ({
      branch: b,
      path: this.createWorktree(b),
    }));

    const results: WorktreeResult[] = [];

    // Fan-out execution (code generation + testing in parallel)
    await Promise.allSettled(
      worktrees.map(async (wt) => {
        let success = false;
        let output = "";
        try {
          // 1. Agent modifies the worktree
          await executeFn(wt.path, wt.branch);

          // 2. Deterministic S0 Arbitration (npm test)
          output = execSync(testCmd, {
            cwd: wt.path,
            encoding: "utf-8",
            stdio: "pipe",
          });
          success = true;
        } catch (err: any) {
          success = false;
          output = err.stdout?.toString() || err.message;
        }
        results.push({ branch: wt.branch, path: wt.path, success, output });
      })
    );

    const winner = results.find((r) => r.success);

    // Prune losers immediately
    for (const wt of worktrees) {
      if (!winner || wt.branch !== winner.branch) {
        this.removeWorktree(wt.path, wt.branch);
      }
    }

    // Merge winner (keep worktree path around until merged, then remove it)
    if (winner) {
      this.mergeWinner(winner.branch);
      this.removeWorktree(winner.path, winner.branch);
    }

    return winner || results[0] || null;
  }
}
