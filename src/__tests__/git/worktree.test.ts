import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GitWorktreeManager } from "../../git/worktree.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

describe("GitWorktreeManager", () => {
  let tmpRepoPath: string;
  let worktreeManager: GitWorktreeManager;

  beforeEach(() => {
    // Setup a dummy git repo in a temporary directory
    tmpRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-test-"));
    execSync("git init", { cwd: tmpRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: tmpRepoPath });
    execSync('git config user.name "Test User"', { cwd: tmpRepoPath });
    fs.writeFileSync(path.join(tmpRepoPath, "file.txt"), "hello world");
    execSync("git add .", { cwd: tmpRepoPath });
    execSync('git commit -m "initial commit"', { cwd: tmpRepoPath });

    worktreeManager = new GitWorktreeManager(tmpRepoPath);
  });

  afterEach(() => {
    fs.rmSync(tmpRepoPath, { recursive: true, force: true });
  });

  it("should create a worktree in the .worktrees directory", () => {
    const wtPath = worktreeManager.createWorktree("test-branch");
    expect(fs.existsSync(wtPath)).toBe(true);
    expect(wtPath).toContain(".worktrees");

    // The branch should exist and have the file
    expect(fs.existsSync(path.join(wtPath, "file.txt"))).toBe(true);
  });

  it("should force remove a worktree and branch", () => {
    const wtPath = worktreeManager.createWorktree("test-branch-2");
    expect(fs.existsSync(wtPath)).toBe(true);

    worktreeManager.removeWorktree(wtPath, "test-branch-2");
    
    // wtPath might still exist as an empty dir, but it shouldn't be a valid worktree
    // However, execSync throws if we try to access it if we actually deleted the git metadata
    // Check if branch is gone
    expect(() => execSync("git show-ref --verify refs/heads/test-branch-2", { cwd: tmpRepoPath, stdio: "ignore" })).toThrow();
  });

  it("should execute speculative branches and pick the winner", async () => {
    // Create a dummy executeFn that succeeds on branch B and fails on branch A
    const executeFn = async (wtPath: string, branch: string) => {
      if (branch === "branch-a") {
        fs.writeFileSync(path.join(wtPath, "code.js"), "const a = 1; // bad code");
      } else if (branch === "branch-b") {
        fs.writeFileSync(path.join(wtPath, "code.js"), 'console.log("winner");');
      }
      execSync("git add .", { cwd: wtPath });
      execSync('git commit -m "update"', { cwd: wtPath });
    };

    // testCmd fails for A and succeeds for B
    // We'll use a bash inline script: check if code.js contains 'winner'
    const testCmd = process.platform === "win32" 
      ? 'findstr "winner" code.js' 
      : 'grep "winner" code.js';

    const result = await worktreeManager.runSpeculativeExecution(
      ["branch-a", "branch-b"],
      executeFn,
      testCmd
    );

    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.branch).toBe("branch-b");

    // Check that winner was merged into main
    const fileContent = fs.readFileSync(path.join(tmpRepoPath, "code.js"), "utf-8");
    expect(fileContent).toContain("winner");

    // Check that branches are cleaned up
    expect(() => execSync("git show-ref --verify refs/heads/branch-a", { cwd: tmpRepoPath, stdio: "ignore" })).toThrow();
    expect(() => execSync("git show-ref --verify refs/heads/branch-b", { cwd: tmpRepoPath, stdio: "ignore" })).toThrow();
  });
});
