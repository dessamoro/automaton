import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createDatabase } from "../../state/database.js";
import { CompoundingGoalsManager } from "../../agent/goals.js";

describe("CompoundingGoalsManager", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "goals-test-"));
    dbPath = path.join(tmpDir, "state.db");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds and organizes goals across multiple horizons", () => {
    const db = createDatabase(dbPath);
    const manager = new CompoundingGoalsManager(db);

    const g1 = manager.addGoal({
      title: "Write unit tests for goals manager",
      horizon: "immediate",
    });

    const g2 = manager.addGoal({
      title: "Decouple survival loop into sovereign ambition engine",
      horizon: "session",
    });

    const g3 = manager.addGoal({
      title: "Grow monthly surplus capital by 25%",
      horizon: "monthly",
      metricTarget: "+25% surplus",
    });

    const g4 = manager.addGoal({
      title: "Self-sustaining autonomous venture with 3 child colonies",
      horizon: "longterm",
    });

    const hierarchy = manager.getActiveHierarchy();
    expect(hierarchy.immediate.length).toBe(1);
    expect(hierarchy.immediate[0].id).toBe(g1.id);
    expect(hierarchy.session.length).toBe(1);
    expect(hierarchy.session[0].id).toBe(g2.id);
    expect(hierarchy.monthly.length).toBe(1);
    expect(hierarchy.monthly[0].id).toBe(g3.id);
    expect(hierarchy.longterm.length).toBe(1);
    expect(hierarchy.longterm[0].id).toBe(g4.id);

    // Update progress and verify auto-completion
    manager.updateProgress(g1.id, 100);
    const activeImmediate = manager.getGoalsByHorizon("immediate", true);
    expect(activeImmediate.length).toBe(0);

    const promptText = manager.formatForPrompt();
    expect(promptText).toContain("--- COMPOUNDING GOALS HIERARCHY ---");
    expect(promptText).toContain("Grow monthly surplus capital by 25%");
    expect(promptText).toContain("Self-sustaining autonomous venture");

    db.close();
  });
});
