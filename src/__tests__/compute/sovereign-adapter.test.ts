import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LocalProvider } from "../../compute/local-provider.js";
import { LocalBudgetTracker } from "../../financial/budget-tracker.js";
import { createSovereignClient } from "../../compute/sovereign-adapter.js";

describe("SovereignClient Adapter", () => {
  let tempDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sovereign-test-"));
    db = new Database(path.join(tempDir, "test.db"));
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
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("satisfies ConwayClient interface using LocalProvider and LocalBudgetTracker", async () => {
    const compute = new LocalProvider(tempDir);
    const budget = new LocalBudgetTracker(db, {
      monthlyBudgetCents: 5000,
      vpsMonthlyCostCents: 0,
    });

    const client = createSovereignClient({
      compute,
      budgetTracker: budget,
    });

    // Test file operations
    await client.writeFile("hello.txt", "sovereign compute");
    const content = await client.readFile("hello.txt");
    expect(content).toBe("sovereign compute");

    // Test command execution
    const execRes = await client.exec("node -e \"console.log('decoupled')\"");
    expect(execRes.exitCode).toBe(0);
    expect(execRes.stdout.trim()).toBe("decoupled");

    // Test budget reflection
    const balance = await client.getCreditsBalance();
    expect(balance).toBe(5000);

    // Test models
    const models = await client.listModels();
    expect(models.length).toBeGreaterThan(0);
  });
});
