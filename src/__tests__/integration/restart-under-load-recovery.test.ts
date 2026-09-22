import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import { createInMemoryDb } from "../orchestration/test-db.js";
import { BOOT_ID } from "../../orchestration/boot-id.js";
import { SimpleAgentTracker } from "../../orchestration/simple-tracker.js";
import { releaseAssignedTo, createGoal, decomposeGoal } from "../../orchestration/task-graph.js";
import { getTaskById, getTasksByGoal } from "../../state/database.js";
import { Orchestrator } from "../../orchestration/orchestrator.js";
import { IdleDetector } from "../../agent/idle-detector.js";
import type { Turn, ToolCallResult } from "../../types.js";

describe("integration/restart-under-load-recovery", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it("boot-time recovery: cleans up dead worker from prior boot and releases tasks safely", () => {
    const tracker = new SimpleAgentTracker({ raw: db } as any);
    const oldBootId = "99999-deadbeef";
    const deadWorkerAddress = `local://${oldBootId}-${ulid()}`;

    // Seed children table with old worker
    db.prepare(`
      INSERT INTO children (id, name, address, sandbox_id, genesis_prompt, status, created_at)
      VALUES (?, ?, ?, ?, 'test genesis', 'running', datetime('now'))
    `).run(ulid(), "worker-generalist-old", deadWorkerAddress, `sb-${oldBootId}`);

    // Seed goal and task assigned to that worker
    const goal = createGoal(db, "Test Goal", "Recover after hard crash");
    decomposeGoal(db, goal.id, [
      {
        parentId: null,
        goalId: goal.id,
        title: "Task 1",
        description: "Must be recovered after crash",
        status: "pending",
        assignedTo: null,
        agentRole: "generalist",
        priority: 1,
        dependencies: [],
        result: null,
      },
    ]);

    const task = getTasksByGoal(db, goal.id)[0];
    db.prepare("UPDATE task_graph SET status = 'assigned', assigned_to = ? WHERE id = ?")
      .run(deadWorkerAddress, task.id);

    // Boot sanitization logic (matching src/index.ts)
    const deadLocalWorkers = tracker.reapLocalWorkers(BOOT_ID);
    expect(deadLocalWorkers).toContain(deadWorkerAddress);

    // Release assigned tasks
    const released = releaseAssignedTo(db, deadLocalWorkers);
    expect(released).toBe(1);

    const recoveredTask = getTaskById(db, task.id);
    expect(recoveredTask?.status).toBe("pending");
    expect(recoveredTask?.assignedTo).toBeNull();
    expect(recoveredTask?.retryCount).toBe(1);
  });

  it("orchestrator runtime: prevents dead-worker reassign loop and respects isWorkerAlive", async () => {
    const tracker = new SimpleAgentTracker();
    tracker.updateStatus = vi.fn();
    const deadWorkerAddress = "local://dead-worker-reassign";

    // Insert dead worker into children
    db.prepare(`
      INSERT INTO children (id, name, address, sandbox_id, genesis_prompt, status, created_at)
      VALUES (?, ?, ?, ?, 'test genesis', 'running', datetime('now'))
    `).run(ulid(), "worker-old", deadWorkerAddress, "sb-dead");

    const goal = createGoal(db, "Test Goal", "Prevent endless loop");
    decomposeGoal(db, goal.id, [
      {
        parentId: null,
        goalId: goal.id,
        title: "Task 1",
        description: "Check liveness during reassign",
        status: "pending",
        assignedTo: null,
        agentRole: "generalist",
        priority: 1,
        dependencies: [],
        result: null,
      },
    ]);

    const task = getTasksByGoal(db, goal.id)[0];
    db.prepare("UPDATE task_graph SET status = 'assigned', assigned_to = ? WHERE id = ?")
      .run(deadWorkerAddress, task.id);

    // Set orchestrator state to 'executing' so it executes tickExecuting and runs stale task recovery
    db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(
      "orchestrator.state",
      JSON.stringify({
        phase: "executing",
        goalId: goal.id,
        activeGoalId: goal.id,
        executingTasks: [task.id],
      }),
    );

    const orchestrator = new Orchestrator({
      db,
      agentTracker: tracker,
      funding: { fundChild: vi.fn(), recallCredits: vi.fn(), getBalance: vi.fn() } as any,
      messaging: { processInbox: vi.fn().mockResolvedValue([]) } as any,
      inference: {} as any,
      identity: { address: "0xparent", name: "parent" } as any,
      config: { disableSpawn: true },
      // Liveness checker returns false for dead worker
      isWorkerAlive: (addr) => addr !== deadWorkerAddress,
    });

    // Run tick: recovers task from dead worker
    await orchestrator.tick();

    const afterTickTask = getTaskById(db, task.id);
    // Task was released from the dead worker; it was NOT left assigned to local://dead-worker-reassign
    expect(afterTickTask?.assignedTo).not.toBe(deadWorkerAddress);
  });

  it("idle breaker: repetitive read-only tool execution (e.g. ls -la) triggers sleep with backoff within 5 turns", () => {
    const detector = new IdleDetector({
      maxUnproductiveTurns: 5,
      warnAfterTurns: 3,
      baseBackoffMs: 30000,
      maxBackoffMs: 300000,
    });

    const createTurn = (index: number): Turn => ({
      id: `turn_${index}`,
      agentId: "agent-1",
      turnNumber: index,
      state: "running",
      thinking: "Thinking about executing ls -la again...",
      toolCalls: [
        {
          id: `call_${index}`,
          name: "exec",
          args: { command: "ls -la" },
          result: "total 408\ndrwxrwxrwx+ 14 codespace codespace 4096 Sep 20 14:09 .",
          durationMs: 15,
        } as ToolCallResult,
      ],
      createdAt: new Date().toISOString(),
    });

    // Turns 1, 2: progressing towards warning
    expect(detector.checkProgress(createTurn(1), "task-1", "goal-1")).toBeNull();
    expect(detector.getWarningDirective()).toBeNull();

    expect(detector.checkProgress(createTurn(2), "task-1", "goal-1")).toBeNull();
    expect(detector.getWarningDirective()).toBeNull();

    // Turn 3: warning threshold reached
    expect(detector.checkProgress(createTurn(3), "task-1", "goal-1")).toBeNull();
    expect(detector.getWarningDirective()).toContain("CRITICAL WARNING: Unproductive idle behavior detected");

    // Turn 4: warning continues
    expect(detector.checkProgress(createTurn(4), "task-1", "goal-1")).toBeNull();

    // Turn 5: idle breaker fires, returns sleep duration with backoff
    const sleepMs = detector.checkProgress(createTurn(5), "task-1", "goal-1");
    expect(sleepMs).toBeGreaterThanOrEqual(30000);
  });
});
