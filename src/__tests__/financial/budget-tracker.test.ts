import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LocalBudgetTracker } from "../../financial/budget-tracker.js";

describe("LocalBudgetTracker", () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-test-"));
    db = new Database(path.join(tmpDir, "test.db"));
    db.exec(`
      CREATE TABLE spend_tracking (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        recipient TEXT,
        domain TEXT,
        category TEXT NOT NULL,
        window_hour TEXT NOT NULL,
        window_day TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("calculates initial empty state as normal tier", () => {
    const tracker = new LocalBudgetTracker(db, {
      monthlyBudgetCents: 5000,
      vpsMonthlyCostCents: 0,
    });
    const state = tracker.getBudgetState();
    expect(state.monthlyBudgetCents).toBe(5000);
    expect(state.spentThisMonthCents).toBe(0);
    expect(state.remainingCents).toBe(5000);
    expect(state.percentUsed).toBe(0);
    expect(tracker.getSurvivalTier()).toBe("normal");
  });

  it("transitions to low_compute and critical as spending increases", () => {
    const tracker = new LocalBudgetTracker(db, {
      monthlyBudgetCents: 1000, // $10 budget
      vpsMonthlyCostCents: 0,
      warningThresholdPercent: 80,
    });

    const currentDay = new Date().toISOString().slice(0, 10);
    const insertSpend = (id: string, amount: number) => {
      db.prepare(`
        INSERT INTO spend_tracking (id, tool_name, amount_cents, category, window_hour, window_day)
        VALUES (?, 'inference', ?, 'inference', 'hour', ?)
      `).run(id, amount, currentDay);
    };

    // 65% spend -> low_compute
    insertSpend("s1", 650);
    expect(tracker.getSurvivalTier()).toBe("low_compute");

    // 85% spend -> critical
    insertSpend("s2", 200);
    expect(tracker.getSurvivalTier()).toBe("critical");

    // 100% spend -> dead
    insertSpend("s3", 150);
    expect(tracker.getSurvivalTier()).toBe("dead");
  });
});
