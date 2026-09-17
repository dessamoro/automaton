import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LocalBudgetTracker } from "../../financial/budget-tracker.js";

describe("Ambition Tier in LocalBudgetTracker", () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ambition-budget-test-"));
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

  it("triggers ambition tier when spending is within surplus threshold", () => {
    const tracker = new LocalBudgetTracker(db, {
      monthlyBudgetCents: 10000, // $100 budget
      vpsMonthlyCostCents: 0,
      ambitionThresholdPercent: 30, // ambition mode when <= 30% spent
    });

    const state = tracker.getBudgetState();
    expect(state.percentUsed).toBe(0);
    expect(tracker.getSurvivalTier()).toBe("ambition");
  });

  it("transitions from ambition to normal, low_compute, critical, and dead as spending grows", () => {
    const tracker = new LocalBudgetTracker(db, {
      monthlyBudgetCents: 1000, // $10 budget
      vpsMonthlyCostCents: 0,
      warningThresholdPercent: 80,
      ambitionThresholdPercent: 20, // ambition <= 20%
    });

    const currentDay = new Date().toISOString().slice(0, 10);
    const insertSpend = (id: string, amount: number) => {
      db.prepare(`
        INSERT INTO spend_tracking (id, tool_name, amount_cents, category, window_hour, window_day)
        VALUES (?, 'inference', ?, 'inference', 'hour', ?)
      `).run(id, amount, currentDay);
    };

    // 10% spend -> ambition
    insertSpend("s1", 100);
    expect(tracker.getSurvivalTier()).toBe("ambition");

    // 40% spend -> normal (above ambition threshold, below 60%)
    insertSpend("s2", 300);
    expect(tracker.getSurvivalTier()).toBe("normal");

    // 65% spend -> low_compute
    insertSpend("s3", 250);
    expect(tracker.getSurvivalTier()).toBe("low_compute");

    // 85% spend -> critical
    insertSpend("s4", 200);
    expect(tracker.getSurvivalTier()).toBe("critical");

    // 100% spend -> dead
    insertSpend("s5", 150);
    expect(tracker.getSurvivalTier()).toBe("dead");
  });

  it("allows updating ambition threshold at runtime", () => {
    const tracker = new LocalBudgetTracker(db, {
      monthlyBudgetCents: 1000,
    });
    // Default without threshold -> normal
    expect(tracker.getSurvivalTier()).toBe("normal");

    // Dynamically set ambition threshold
    tracker.updateConfig({ ambitionThresholdPercent: 50 });
    expect(tracker.getSurvivalTier()).toBe("ambition");
  });
});
