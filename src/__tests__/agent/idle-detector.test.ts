import { describe, it, expect, beforeEach } from "vitest";
import { IdleDetector } from "../../agent/idle-detector.js";
import type { AgentTurn } from "../../types.js";

describe("IdleDetector", () => {
  let detector: IdleDetector;

  beforeEach(() => {
    detector = new IdleDetector({
      maxUnproductiveTurns: 5,
      warnAfterTurns: 3,
      baseBackoffMs: 30000,
      maxBackoffMs: 300000,
    });
  });

  it("should initialize as not idle", () => {
    expect(detector.getWarningDirective()).toBeNull();
    expect(detector.getBackoffMs()).toBe(30000);
  });

  it("should mark progress on productive tools", () => {
    const turn: AgentTurn = {
      id: "1",
      goalId: "g1",
      taskId: "t1",
      timestamp: Date.now(),
      status: "completed",
      toolCalls: [{ name: "exec", toolName: "exec", args: {}, result: "" }],
      tokenUsage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };

    expect(detector.checkProgress(turn, "t1", "g1")).toBeNull();
  });

  it("should detect unproductive turns and enter idle state", () => {
    const turn: AgentTurn = {
      id: "1",
      goalId: "g1",
      taskId: "t1",
      timestamp: Date.now(),
      status: "completed",
      toolCalls: [{ name: "view_file", toolName: "view_file", args: {}, result: "" }],
      tokenUsage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };

    expect(detector.checkProgress(turn, "t1", "g1")).toBeNull();
    expect(detector.getWarningDirective()).toBeNull(); // 1

    expect(detector.checkProgress(turn, "t1", "g1")).toBeNull();
    expect(detector.getWarningDirective()).toBeNull(); // 2

    expect(detector.checkProgress(turn, "t1", "g1")).toBeNull();
    expect(detector.getWarningDirective()).not.toBeNull(); // 3 -> Warning
    
    expect(detector.checkProgress(turn, "t1", "g1")).toBeNull();
    expect(detector.getWarningDirective()).not.toBeNull(); // 4 -> Warning

    const sleepMs = detector.checkProgress(turn, "t1", "g1");
    expect(sleepMs).toBe(30000); // 5 -> Idle (30s)
  });
  
  it("should warn at 3 and sleep at 5 for repeated exec ls, growing backoff across sleeps", () => {
    const makeExecTurn = (cmd: string): AgentTurn => ({
      id: "1", goalId: "g1", taskId: "t1", timestamp: Date.now(), status: "completed",
      toolCalls: [{ name: "exec", arguments: { command: cmd } } as any],
      tokenUsage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    const turnLs = makeExecTurn("ls -la");

    expect(detector.checkProgress(turnLs, "t1", "g1")).toBeNull(); // 1
    expect(detector.checkProgress(turnLs, "t1", "g1")).toBeNull(); // 2
    expect(detector.checkProgress(turnLs, "t1", "g1")).toBeNull(); // 3 (warning)
    expect(detector.getWarningDirective()).not.toBeNull();
    
    expect(detector.checkProgress(turnLs, "t1", "g1")).toBeNull(); // 4 (warning)
    expect(detector.getWarningDirective()).not.toBeNull();
    
    // sleep at 5, backoff level 0 -> 1 (30s)
    let sleepMs = detector.checkProgress(turnLs, "t1", "g1");
    expect(sleepMs).toBe(30000); // 5 -> sleep
    
    // Unproductive turns reset, backoff level is 1
    // sleep at 5 again
    for (let i = 0; i < 4; i++) {
      expect(detector.checkProgress(turnLs, "t1", "g1")).toBeNull();
    }
    sleepMs = detector.checkProgress(turnLs, "t1", "g1");
    expect(sleepMs).toBe(60000); // Backoff level 2 (60s)
    
    for (let i = 0; i < 4; i++) {
      expect(detector.checkProgress(turnLs, "t1", "g1")).toBeNull();
    }
    sleepMs = detector.checkProgress(turnLs, "t1", "g1");
    expect(sleepMs).toBe(120000); // Backoff level 3 (120s)
  });

  it("should reset counters on a productive exec command", () => {
    const makeExecTurn = (cmd: string): AgentTurn => ({
      id: "1", goalId: "g1", taskId: "t1", timestamp: Date.now(), status: "completed",
      toolCalls: [{ name: "exec", arguments: { command: cmd } } as any],
      tokenUsage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    const turnLs = makeExecTurn("ls -la");
    const turnTest = makeExecTurn("npm test");

    for (let i = 0; i < 4; i++) {
      expect(detector.checkProgress(turnLs, "t1", "g1")).toBeNull();
    }
    expect(detector.getWarningDirective()).not.toBeNull();
    
    expect(detector.checkProgress(turnTest, "t1", "g1")).toBeNull();
    expect(detector.getWarningDirective()).toBeNull();
  });
});
