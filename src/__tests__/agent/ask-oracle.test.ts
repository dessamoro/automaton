import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBuiltinTools, executeTool } from "../../agent/tools.js";
import { LoopDetector } from "../../agent/loop-detector.js";
import { createDatabase } from "../../state/database.js";
import type { ToolContext, AutomatonDatabase } from "../../types.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("Lakshmi Framework — Oracle Protocol & Awareness", () => {
  let dbPath: string;
  let db: AutomatonDatabase;
  let context: ToolContext;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `automaton-oracle-test-${Date.now()}.db`);
    db = createDatabase(dbPath);
    context = {
      db,
    } as unknown as ToolContext;
  });

  afterEach(() => {
    db.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {}
  });

  it("ask_oracle records pending question in KV", async () => {
    const tools = createBuiltinTools("test-sandbox");
    const result = await executeTool(
      "ask_oracle",
      { question: "How do I run the server?", context: "Tried port 80" },
      tools,
      context,
    );

    expect(result.result).toContain("Oracle request recorded");
    const pending = db.getKV("oracle_pending_question");
    expect(pending).not.toBeNull();
    const parsed = JSON.parse(pending!);
    expect(parsed.question).toBe("How do I run the server?");
    expect(parsed.context).toBe("Tried port 80");
  });

  it("ask_oracle blocks immediate follow-up with cooldown guard", async () => {
    const tools = createBuiltinTools("test-sandbox");

    // First call succeeds
    const res1 = await executeTool(
      "ask_oracle",
      { question: "First question" },
      tools,
      context,
    );
    expect(res1.result).toContain("Oracle request recorded");

    // Immediate second call should be caught by pending question / cooldown check
    const res2 = await executeTool(
      "ask_oracle",
      { question: "Second question immediately" },
      tools,
      context,
    );
    expect(res2.result).toContain("You already asked a question");
  });

  it("LoopDetector detects permission errors and injects codespace / sandbox hint", () => {
    const detector = new LoopDetector({ maxIdenticalCalls: 3 });

    detector.recordToolCall("write_file", JSON.stringify({ path: "/root/agent_service.py" }));
    detector.recordToolCall("write_file", JSON.stringify({ path: "/root/agent_service.py" }));
    const third = detector.recordToolCall("write_file", JSON.stringify({ path: "/root/agent_service.py" }));

    expect(third.blocked).toBe(true);
    expect(third.reason).toContain("This appears to be a permission error");
    expect(third.reason).toContain("codespace");
    expect(third.reason).toContain(".sandbox/");
    expect(third.reason).toContain("ask_oracle");
  });

  it("LoopDetector escalates to ask_oracle on repeated blocked loops", () => {
    const detector = new LoopDetector({ maxIdenticalCalls: 2 });

    // Loop 1
    detector.recordToolCall("toolA", "{}");
    const r1 = detector.recordToolCall("toolA", "{}");
    expect(r1.blocked).toBe(true);

    // Loop 2
    detector.recordToolCall("toolB", "{}");
    const r2 = detector.recordToolCall("toolB", "{}");
    expect(r2.blocked).toBe(true);

    // Loop 3
    detector.recordToolCall("toolC", "{}");
    const r3 = detector.recordToolCall("toolC", "{}");
    expect(r3.blocked).toBe(true);
    expect(r3.reason).toContain("You have encountered multiple loops");
    expect(r3.reason).toContain("Call ask_oracle");
  });
});
