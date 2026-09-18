import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SignalQueueManager, CompoundingGoalsManager } from "../../agent/goals.js";

describe("SignalQueueManager", () => {
  let tempDir: string;
  let mockDb: any;
  let kvStore: Map<string, string>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "signal-queue-test-"));
    kvStore = new Map();
    mockDb = {
      getKV: (key: string) => kvStore.get(key) || null,
      setKV: (key: string, val: string) => kvStore.set(key, val),
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates queue, processed, and expired directories", () => {
    new SignalQueueManager(tempDir);
    expect(fs.existsSync(path.join(tempDir, "signals", "queue"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "signals", "processed"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "signals", "expired"))).toBe(true);
  });

  it("ingests valid signals and moves them to processed/", () => {
    const queueManager = new SignalQueueManager(tempDir);
    const goalsManager = new CompoundingGoalsManager(mockDb);

    const validSignal = {
      schema_version: "1.0",
      id: "sig-001",
      source: "algora",
      fingerprint: "fp-001",
      title: "Fix memory leak",
      url: "https://github.com/org/repo/issues/1",
      reward_usd: 50.0,
      compute_budget_usd: 0.5,
      net_margin_usd: 49.5,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    };

    const queueFile = path.join(tempDir, "signals", "queue", "sig_001.json");
    fs.writeFileSync(queueFile, JSON.stringify(validSignal), "utf-8");

    const ingested = queueManager.processPendingSignals(goalsManager);
    expect(ingested).toHaveLength(1);
    expect(ingested[0].id).toBe("sig-001");

    // File moved to processed/
    expect(fs.existsSync(queueFile)).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "signals", "processed", "sig_001.json"))).toBe(true);

    // Goal added to immediate horizon
    const goals = goalsManager.getGoalsByHorizon("immediate");
    expect(goals).toHaveLength(1);
    expect(goals[0].title).toContain("Fix memory leak");
  });

  it("drops expired signals to expired/ directory without adding goals", () => {
    const queueManager = new SignalQueueManager(tempDir);
    const goalsManager = new CompoundingGoalsManager(mockDb);

    const expiredSignal = {
      schema_version: "1.0",
      id: "sig-002",
      source: "algora",
      fingerprint: "fp-002",
      title: "Stale opportunity",
      url: "https://github.com/org/repo/issues/2",
      reward_usd: 25.0,
      compute_budget_usd: 0.25,
      net_margin_usd: 24.75,
      created_at: new Date(Date.now() - 3600_000).toISOString(),
      expires_at: new Date(Date.now() - 1000).toISOString(), // expired 1s ago
    };

    const queueFile = path.join(tempDir, "signals", "queue", "sig_002.json");
    fs.writeFileSync(queueFile, JSON.stringify(expiredSignal), "utf-8");

    const ingested = queueManager.processPendingSignals(goalsManager);
    expect(ingested).toHaveLength(0);

    // File moved to expired/
    expect(fs.existsSync(queueFile)).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "signals", "expired", "sig_002.json"))).toBe(true);

    // No goals added
    const goals = goalsManager.getGoalsByHorizon("immediate");
    expect(goals).toHaveLength(0);
  });
});
