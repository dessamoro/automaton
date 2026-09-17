import { describe, it, expect } from "vitest";
import { getActiveToolsForTurn, CORE_TOOL_NAMES } from "../../skills/dynamic-toolset.js";
import { createBuiltinTools } from "../../agent/tools.js";

describe("Dynamic Toolset (Phase 5: Tool Surface Reduction)", () => {
  const allTools = createBuiltinTools("test-sandbox");

  it("reduces 70+ tools down to core primitives on standard idle turn", () => {
    const active = getActiveToolsForTurn(allTools, {
      userPrompt: "Hello, what is your current state?",
    });

    // Should have around 5-8 tools instead of 77!
    expect(active.length).toBeLessThan(15);
    expect(active.length).toBeGreaterThan(0);

    // Core tools must be present
    expect(active.some(t => t.name === "exec")).toBe(true);
    expect(active.some(t => t.name === "read_file")).toBe(true);
    expect(active.some(t => t.name === "write_file")).toBe(true);
    expect(active.some(t => t.name === "discover_skills")).toBe(true);

    // Specialized tools should NOT be present when irrelevant
    expect(active.some(t => t.name === "spawn_child")).toBe(false);
    expect(active.some(t => t.name === "git_commit")).toBe(false);
  });

  it("dynamically loads git tools when prompt mentions git or commit", () => {
    const active = getActiveToolsForTurn(allTools, {
      userPrompt: "Please check git status and commit our changes",
    });

    expect(active.some(t => t.name === "git_status")).toBe(true);
    expect(active.some(t => t.name === "git_commit")).toBe(true);
  });

  it("dynamically loads memory tools when prompt mentions remember or recall", () => {
    const active = getActiveToolsForTurn(allTools, {
      userPrompt: "Please remember that our main database is SQLite",
    });

    expect(active.some(t => t.name === "remember_fact")).toBe(true);
  });
});
