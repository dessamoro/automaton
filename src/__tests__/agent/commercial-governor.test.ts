import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../../state/database.js";
import { CommercialGovernor } from "../../agent/commercial-governor.js";
import type { AutomatonDatabase, Opportunity } from "../../types.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("Commercial Governor & Opportunity Ledger", () => {
  let db: AutomatonDatabase;
  let dbPath: string;
  let tmpDir: string;
  let governor: CommercialGovernor;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "automaton-comm-test-"));
    dbPath = path.join(tmpDir, "test.db");
    db = createDatabase(dbPath);
    governor = new CommercialGovernor(db, {
      maxAllowedRisk: 0.5,
      defaultTokenSpendCapUsd: 0.50,
      minRewardUsd: 1.00,
    });
  });

  afterEach(() => {
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("calculates expected value and selection score correctly", () => {
    // EV = (0.5 * 100) - 10 = 40
    const ev = governor.calculateExpectedValue(100, 10, 0.5);
    expect(ev).toBe(40);

    // EV = (0.2 * 50) - 20 = -10 (negative EV)
    const negativeEv = governor.calculateExpectedValue(50, 20, 0.2);
    expect(negativeEv).toBe(-10);

    // Selection score = EV / duration = 40 / 20 = 2.0
    const score = governor.calculateSelectionScore(ev, 20);
    expect(score).toBe(2.0);

    // Duration clamp: min duration is 1
    const clampedScore = governor.calculateSelectionScore(10, 0);
    expect(clampedScore).toBe(10);
  });

  it("filters out negative EV, over-budget, and high-risk candidates", () => {
    const opps: Opportunity[] = [
      {
        id: "opp-good",
        type: "bounty",
        source: "github",
        target: "https://github.com/test/repo1",
        title: "Fix memory leak",
        estimatedRevenue: 50,
        estimatedCost: 0.20,
        estimatedProb: 0.40,
        expectedValue: 19.8,
        estimatedDurationMin: 15,
        evPerMinute: 1.32,
        riskScore: 0.2,
        selectionScore: 1.32,
        status: "discovered",
        createdAt: new Date().toISOString(),
        actualRevenue: 0,
        actualCost: 0,
      },
      {
        id: "opp-overbudget",
        type: "bounty",
        source: "github",
        target: "https://github.com/test/repo2",
        title: "Rewrite database engine",
        estimatedRevenue: 500,
        estimatedCost: 10.00, // exceeds remaining budget ($1.00)
        estimatedProb: 0.50,
        expectedValue: 240,
        estimatedDurationMin: 120,
        evPerMinute: 2.0,
        riskScore: 0.3,
        selectionScore: 2.0,
        status: "discovered",
        createdAt: new Date().toISOString(),
        actualRevenue: 0,
        actualCost: 0,
      },
      {
        id: "opp-negative-ev",
        type: "bounty",
        source: "github",
        target: "https://github.com/test/repo3",
        title: "Trivial doc typo with high gas fee",
        estimatedRevenue: 1,
        estimatedCost: 2.00,
        estimatedProb: 0.50,
        expectedValue: -1.5,
        estimatedDurationMin: 5,
        evPerMinute: -0.3,
        riskScore: 0.1,
        selectionScore: -0.3,
        status: "discovered",
        createdAt: new Date().toISOString(),
        actualRevenue: 0,
        actualCost: 0,
      },
      {
        id: "opp-high-risk",
        type: "bounty",
        source: "github",
        target: "https://github.com/test/repo4",
        title: "Experimental kernel bypass",
        estimatedRevenue: 100,
        estimatedCost: 0.30,
        estimatedProb: 0.30,
        expectedValue: 29.7,
        estimatedDurationMin: 10,
        evPerMinute: 2.97,
        riskScore: 0.85, // exceeds allowed risk (0.50)
        selectionScore: 2.97,
        status: "discovered",
        createdAt: new Date().toISOString(),
        actualRevenue: 0,
        actualCost: 0,
      },
    ];

    // Budget: $1.00 (100 cents)
    const ranked = governor.rankOpportunities(opps, 100, 0.5);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe("opp-good");
  });

  it("persists opportunities to SQLite and ranks from ledger", () => {
    const opp1: Opportunity = {
      id: "bounty-1",
      type: "bounty",
      source: "github",
      target: "https://github.com/org/repo/issues/1",
      title: "Add dark mode toggle",
      estimatedRevenue: 25,
      estimatedCost: 0.10,
      estimatedProb: 0.6,
      expectedValue: 14.9,
      estimatedDurationMin: 15,
      evPerMinute: 0.993,
      riskScore: 0.15,
      selectionScore: 0.993,
      status: "discovered",
      createdAt: new Date().toISOString(),
      actualRevenue: 0,
      actualCost: 0,
    };

    const opp2: Opportunity = {
      id: "bounty-2",
      type: "bounty",
      source: "github",
      target: "https://github.com/org/repo/issues/2",
      title: "Optimize API latency",
      estimatedRevenue: 100,
      estimatedCost: 0.25,
      estimatedProb: 0.5,
      expectedValue: 49.75,
      estimatedDurationMin: 20,
      evPerMinute: 2.488,
      riskScore: 0.20,
      selectionScore: 2.488,
      status: "discovered",
      createdAt: new Date().toISOString(),
      actualRevenue: 0,
      actualCost: 0,
    };

    db.recordOpportunity?.(opp1);
    db.recordOpportunity?.(opp2);

    // Select best candidate for $5.00 budget
    const selected = governor.selectBestOpportunity(500);

    expect(selected).not.toBeNull();
    expect(selected?.id).toBe("bounty-2");
    expect(selected?.status).toBe("selected");
    expect(selected?.missionContract).toBeDefined();
    expect(selected?.missionContract?.objective).toContain("Optimize API latency");
    expect(selected?.missionContract?.economicValue).toBe(100);
  });

  it("handles the complete mission lifecycle through external verification", async () => {
    const opp: Opportunity = {
      id: "lifecycle-opp",
      type: "bounty",
      source: "github",
      target: "https://github.com/bounties/active/42",
      title: "Implement zero-downtime migration",
      estimatedRevenue: 50,
      estimatedCost: 0.30,
      estimatedProb: 0.50,
      expectedValue: 24.7,
      estimatedDurationMin: 30,
      evPerMinute: 0.823,
      riskScore: 0.2,
      selectionScore: 0.823,
      status: "discovered",
      createdAt: new Date().toISOString(),
      actualRevenue: 0,
      actualCost: 0,
    };

    db.recordOpportunity?.(opp);

    // 1. Select
    const selected = governor.selectBestOpportunity(500);
    expect(selected?.status).toBe("selected");

    // 2. Start Execution
    governor.startMissionExecution("lifecycle-opp");
    let current = governor.getActiveMission();
    expect(current?.status).toBe("executing");

    // 3. Worker attempts self-declaration - cannot self-settle without proof
    const verifyPending = await governor.verifyMissionSettlement("lifecycle-opp");
    expect(verifyPending.verified).toBe(true);
    expect(verifyPending.settled).toBe(false);

    // 4. Authoritative external verifier confirms payment of $50.00
    const finalSettlement = await governor.verifyMissionSettlement("lifecycle-opp", {
      actualRevenue: 50.00,
      actualCost: 0.28,
    });
    expect(finalSettlement.settled).toBe(true);

    const settledOpp = db.getOpportunityById?.("lifecycle-opp");
    expect(settledOpp?.status).toBe("settled");
    expect(settledOpp?.actualRevenue).toBe(50.00);
    expect(settledOpp?.actualCost).toBe(0.28);
    expect(settledOpp?.completedAt).toBeDefined();

    // Active mission is now cleared
    expect(governor.getActiveMission()).toBeUndefined();
  });

  it("handles mission failure taxonomy and records failure category", () => {
    const opp: Opportunity = {
      id: "failing-opp",
      type: "bounty",
      source: "github",
      target: "https://github.com/bounties/active/99",
      title: "Flaky unit test repair",
      estimatedRevenue: 20,
      estimatedCost: 0.10,
      estimatedProb: 0.40,
      expectedValue: 7.9,
      estimatedDurationMin: 10,
      evPerMinute: 0.79,
      riskScore: 0.2,
      selectionScore: 0.79,
      status: "discovered",
      createdAt: new Date().toISOString(),
      actualRevenue: 0,
      actualCost: 0,
    };

    db.recordOpportunity?.(opp);
    governor.selectBestOpportunity(200);
    governor.startMissionExecution("failing-opp");

    governor.failMission("failing-opp", "FAILED_TEST", "Test suite exited with code 1", 0.08);

    const recorded = db.getOpportunityById?.("failing-opp");
    expect(recorded?.status).toBe("failed");
    expect(recorded?.failureCategory).toBe("FAILED_TEST");
    expect(recorded?.failureReason).toContain("Test suite exited with code 1");
    expect(recorded?.actualCost).toBe(0.08);
  });

  it("enforces FDV-001 authoritative milestone tracking and verified != settled", () => {
    // 1. Initial goal state: $0 / $1.00
    const goalInitial = db.getCommercialGoal?.("FDV-001");
    expect(goalInitial?.targetRevenueUsd).toBe(1.00);
    expect(goalInitial?.realizedRevenueUsd).toBe(0.00);
    expect(goalInitial?.status).toBe("active");

    const opp: Opportunity = {
      id: "fdv-bounty",
      type: "bounty",
      source: "github",
      target: "https://github.com/org/repo/issues/101",
      title: "Fix crash on invalid UTF-8",
      estimatedRevenue: 10,
      estimatedCost: 0.12,
      estimatedProb: 0.70,
      expectedValue: 6.88,
      estimatedDurationMin: 15,
      evPerMinute: 0.458,
      riskScore: 0.1,
      selectionScore: 0.458,
      status: "discovered",
      createdAt: new Date().toISOString(),
      actualRevenue: 0,
      actualCost: 0,
      predictedProbability: 0.70,
    };

    db.recordOpportunity?.(opp);
    governor.selectBestOpportunity(500);
    governor.startMissionExecution("fdv-bounty");

    // 2. Deliver PR: verified execution, but NOT settled
    governor.recordExecutionSubmitted("fdv-bounty", "https://github.com/org/repo/pull/102");
    let inProgressOpp = db.getOpportunityById?.("fdv-bounty");
    expect(inProgressOpp?.status).toBe("submitted");
    expect(inProgressOpp?.actualRevenue).toBe(0);

    // Goal must still be $0 (a PR sitting open is NOT revenue)
    let goalAfterPR = db.getCommercialGoal?.("FDV-001");
    expect(goalAfterPR?.realizedRevenueUsd).toBe(0.00);
    expect(goalAfterPR?.status).toBe("active");

    // 3. Authoritative payment confirmation arrives from Base blockchain
    const settlementResult = governor.recordSettlement(
      "fdv-bounty",
      {
        amount: 10.00,
        txHash: "0xabc123def456_tx_hash",
      },
      0.11,
    );

    expect(settlementResult.settled).toBe(true);
    expect(settlementResult.fdvAchieved).toBe(true);
    expect(settlementResult.totalRealized).toBe(10.00);

    // Goal is now officially achieved!
    const goalAchieved = db.getCommercialGoal?.("FDV-001");
    expect(goalAchieved?.status).toBe("achieved");
    expect(goalAchieved?.realizedRevenueUsd).toBe(10.00);
    expect(goalAchieved?.settlementProofs[0].txHash).toBe("0xabc123def456_tx_hash");
    expect(goalAchieved?.settlementProofs[0].verificationMethod).toBe("onchain_rpc");
    expect(goalAchieved?.completedAt).toBeDefined();

    // Actual outcome is marked as 1 for calibration
    const settledOpp = db.getOpportunityById?.("fdv-bounty");
    expect(settledOpp?.status).toBe("settled");
    expect(settledOpp?.actualOutcome).toBe(1);
  });

  it("calculates Brier score and probability calibration telemetry", () => {
    // Add 1 settled opportunity (predicted 0.8, actual 1) and 1 failed opportunity (predicted 0.4, actual 0)
    const opp1: Opportunity = {
      id: "calib-1",
      type: "bounty",
      source: "github",
      target: "https://test.com/1",
      title: "Task 1",
      estimatedRevenue: 5,
      estimatedCost: 0.1,
      estimatedProb: 0.8,
      expectedValue: 3.9,
      estimatedDurationMin: 10,
      evPerMinute: 0.39,
      riskScore: 0.1,
      selectionScore: 0.39,
      status: "discovered",
      createdAt: new Date().toISOString(),
      actualRevenue: 0,
      actualCost: 0,
      predictedProbability: 0.8,
    };

    const opp2: Opportunity = {
      id: "calib-2",
      type: "bounty",
      source: "github",
      target: "https://test.com/2",
      title: "Task 2",
      estimatedRevenue: 15,
      estimatedCost: 0.2,
      estimatedProb: 0.4,
      expectedValue: 5.8,
      estimatedDurationMin: 10,
      evPerMinute: 0.58,
      riskScore: 0.2,
      selectionScore: 0.58,
      status: "discovered",
      createdAt: new Date().toISOString(),
      actualRevenue: 0,
      actualCost: 0,
      predictedProbability: 0.4,
    };

    db.recordOpportunity?.(opp1);
    db.recordOpportunity?.(opp2);

    // Settle opp1
    governor.recordSettlement("calib-1", { amount: 5.0, txHash: "tx-calib-1" });

    // Fail opp2
    governor.failMission("calib-2", "FAILED_TEST", "Tests failed");

    const metrics = governor.getCalibrationMetrics();
    expect(metrics.totalCompleted).toBe(2);
    expect(metrics.empiricalSuccessRate).toBe(0.5); // 1 out of 2
    expect(metrics.meanPredictedProb).toBe(0.6); // (0.8 + 0.4) / 2
    // Brier score: ((0.8 - 1)^2 + (0.4 - 0)^2) / 2 = (0.04 + 0.16) / 2 = 0.10
    expect(metrics.brierScore).toBe(0.1);
  });
});


