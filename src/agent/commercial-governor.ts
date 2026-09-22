/**
 * Commercial Governor — Economic Decision & Control Plane
 *
 * Sits above the runtime safety layer (IdleDetector, LocalWorkerPool, BOOT_ID sanitization).
 * Enforces bounded, positive-EV mission contracts and prevents open-ended directory drifting.
 *
 * Core Selection Formula:
 *   eligible = (expected_value > 0)
 *          AND (estimated_cost <= remaining_budget)
 *          AND (risk <= allowed_risk)
 *   selection_score = expected_value / max(estimated_duration_min, 1)
 */

import { ulid } from "ulid";
import type {
  AutomatonDatabase,
  Opportunity,
  OpportunityStatus,
  MissionContract,
  FailureCategory,
} from "../types.js";
import {
  recordOpportunity,
  getOpportunityById,
  getEligibleOpportunities,
  updateOpportunityStatus,
  getActiveOpportunity,
  listOpportunities,
  getCommercialGoal,
  recordCommercialSettlement,
} from "../state/database.js";
import { fetchAllBounties, type FetchBountiesOptions } from "../bounties/bounty-hunter.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("commercial.governor");

export interface CommercialGovernorConfig {
  maxAllowedRisk?: number; // default 0.5 (on a 0.0 - 1.0 scale)
  defaultTokenSpendCapUsd?: number; // default $0.50
  minRewardUsd?: number; // default $1.00 for First Dollar Validation
}

export class CommercialGovernor {
  private db: AutomatonDatabase;
  private config: Required<CommercialGovernorConfig>;

  constructor(db: AutomatonDatabase, config?: CommercialGovernorConfig) {
    this.db = db;
    this.config = {
      maxAllowedRisk: config?.maxAllowedRisk ?? 0.5,
      defaultTokenSpendCapUsd: config?.defaultTokenSpendCapUsd ?? 0.50,
      minRewardUsd: config?.minRewardUsd ?? 1.00,
    };
  }

  /**
   * Calculate Expected Value: (prob * gross_revenue) - compute_cost
   */
  public calculateExpectedValue(revenue: number, cost: number, prob: number): number {
    const clampedProb = Math.max(0, Math.min(1, prob));
    const ev = (clampedProb * revenue) - cost;
    return Math.round(ev * 1000) / 1000;
  }

  /**
   * Calculate selection score (EV per minute): expected_value / max(duration, 1)
   */
  public calculateSelectionScore(expectedValue: number, estimatedDurationMin: number): number {
    const duration = Math.max(1, estimatedDurationMin);
    return Math.round((expectedValue / duration) * 1000) / 1000;
  }

  /**
   * Filter and rank opportunities based on constrained EV criteria:
   *   1. expected_value > 0
   *   2. estimated_cost <= remaining_budget
   *   3. risk_score <= allowed_risk
   * Ranked descending by selection_score.
   */
  public rankOpportunities(
    candidates: Opportunity[],
    remainingBudgetCents: number,
    allowedRisk: number = this.config.maxAllowedRisk,
  ): Opportunity[] {
    const remainingBudgetUsd = remainingBudgetCents / 100;

    return candidates
      .filter((opp) => {
        const isPositiveEv = opp.expectedValue > 0;
        const isWithinBudget = opp.estimatedCost <= remainingBudgetUsd;
        const isAcceptableRisk = opp.riskScore <= allowedRisk;
        return isPositiveEv && isWithinBudget && isAcceptableRisk;
      })
      .sort((a, b) => b.selectionScore - a.selectionScore);
  }

  /**
   * Select the single best active or qualified opportunity.
   * If an opportunity is already executing or selected, resumes it.
   */
  public selectBestOpportunity(remainingBudgetCents: number): Opportunity | null {
    // 1. If there's an ongoing active mission, resume it
    const active = getActiveOpportunity(this.db.raw);
    if (active) {
      logger.info(`Resuming existing active mission: ${active.title} [${active.status}]`);
      return active;
    }

    // 2. Fetch candidates from ledger that meet budget & risk constraints
    const candidates = getEligibleOpportunities(
      this.db.raw,
      remainingBudgetCents,
      this.config.maxAllowedRisk,
    );

    if (candidates.length === 0) {
      logger.debug("No eligible positive-EV opportunities in ledger for current budget.");
      return null;
    }

    const ranked = this.rankOpportunities(candidates, remainingBudgetCents);
    if (ranked.length === 0) {
      return null;
    }

    const best = ranked[0];

    // 3. Generate mission contract if not already present
    if (!best.missionContract) {
      best.missionContract = this.createMissionContract(best);
    }

    // 4. Mark status as 'selected'
    updateOpportunityStatus(this.db.raw, best.id, "selected", {
      missionContract: best.missionContract,
    });
    best.status = "selected";

    logger.info(`Commercial Governor selected top mission: "${best.title}" (EV: $${best.expectedValue}, Score: ${best.selectionScore})`);
    return best;
  }

  /**
   * Create an immutable Mission Contract for worker execution.
   */
  public createMissionContract(
    opportunity: Opportunity,
    maxSpendDollars?: number,
  ): MissionContract {
    const spendLimit = maxSpendDollars ?? Math.min(
      opportunity.estimatedCost * 1.5,
      this.config.defaultTokenSpendCapUsd,
    );

    const isBounty = opportunity.type === "bounty";
    const tools = isBounty
      ? ["bash", "read_file", "write_file", "edit_file", "git_commit_and_push", "inspect_bounty", "submit_bounty_pr"]
      : ["bash", "read_file", "write_file", "edit_file"];

    return {
      opportunityId: opportunity.id,
      title: opportunity.title,
      target: opportunity.target,
      objective: `Execute commercial mission to earn $${opportunity.estimatedRevenue.toFixed(2)}: ${opportunity.title}. Target: ${opportunity.target}`,
      successConditions: [
        "Clone or inspect repository in isolated workspace",
        "Implement solution resolving the issue / bounty criteria",
        "Verify solution with clean passing automated tests",
        "Submit pull request linking bounty and payout address",
        "Authoritative payment settlement confirmed by external system",
      ],
      maxComputeCost: spendLimit,
      estimatedDurationMin: opportunity.estimatedDurationMin,
      economicValue: opportunity.estimatedRevenue,
      allowedTools: tools,
      verifierType: isBounty ? "github_pr" : "test_suite",
    };
  }

  /**
   * Discover and ingest open bounties into the Opportunity Ledger.
   */
  public async discoverBounties(options?: FetchBountiesOptions): Promise<Opportunity[]> {
    try {
      const items = await fetchAllBounties({
        minRewardUsd: this.config.minRewardUsd,
        ...options,
      });

      const discovered: Opportunity[] = [];

      for (const item of items) {
        if (item.rewardUsd < this.config.minRewardUsd) {
          continue;
        }

        const existing = getOpportunityById(this.db.raw, item.id);
        if (existing) {
          continue;
        }

        // Conservative baseline calibration
        const estimatedRevenue = item.rewardUsd;
        const estimatedCost = 0.15; // default token budget ~ $0.15
        const estimatedProb = 0.35; // 35% probability of successful merge/settlement
        const estimatedDurationMin = 20; // 20 minutes estimated time
        const riskScore = 0.25;

        const ev = this.calculateExpectedValue(estimatedRevenue, estimatedCost, estimatedProb);
        const evPerMin = this.calculateSelectionScore(ev, estimatedDurationMin);

        const opp: Opportunity = {
          id: item.id,
          type: "bounty",
          source: item.source,
          target: item.url,
          title: item.title,
          description: `Bounty tags: ${item.tags.join(", ")} | Repo: ${item.repo || item.url}`,
          estimatedRevenue,
          estimatedCost,
          estimatedProb,
          expectedValue: ev,
          estimatedDurationMin,
          evPerMinute: evPerMin,
          riskScore,
          selectionScore: evPerMin,
          status: "discovered",
          createdAt: new Date().toISOString(),
          actualRevenue: 0,
          actualCost: 0,
          predictedProbability: estimatedProb,
        };

        recordOpportunity(this.db.raw, opp);
        discovered.push(opp);
      }

      logger.info(`Discovered and ingested ${discovered.length} new commercial opportunities`);
      return discovered;
    } catch (err: any) {
      logger.error("Failed to discover bounties", err instanceof Error ? err : new Error(String(err)));
      return [];
    }
  }

  /**
   * Transition mission to executing.
   */
  public startMissionExecution(opportunityId: string): void {
    updateOpportunityStatus(this.db.raw, opportunityId, "executing");
    logger.info(`Mission [${opportunityId}] transitioned to EXECUTING`);
  }

  /**
   * Record delivery/submission of work (VERIFIED_EXECUTION).
   * Note: Submitting work is NOT settlement. It moves status to 'submitted'.
   */
  public recordExecutionSubmitted(opportunityId: string, prUrl?: string): void {
    updateOpportunityStatus(this.db.raw, opportunityId, "submitted", {
      failureReason: prUrl ? `Delivered PR: ${prUrl}` : undefined,
    });
    logger.info(`Mission [${opportunityId}] transitioned to SUBMITTED (verified execution, awaiting settlement)`);
  }

  /**
   * Record authoritative external settlement.
   * Only the payment confirmation transitions status to 'settled' and increments FDV-001.
   */
  public recordSettlement(
    opportunityId: string,
    actualRevenue: number,
    proof: string,
    actualCost?: number,
  ): { settled: boolean; fdvAchieved: boolean; totalRealized: number } {
    const opp = getOpportunityById(this.db.raw, opportunityId);
    if (!opp) {
      throw new Error(`Opportunity ${opportunityId} not found`);
    }

    updateOpportunityStatus(this.db.raw, opportunityId, "settled", {
      actualRevenue,
      actualCost: actualCost ?? opp.actualCost,
    });

    const goal = recordCommercialSettlement(this.db.raw, "FDV-001", actualRevenue, proof);
    const fdvAchieved = goal.status === "achieved";

    if (fdvAchieved) {
      logger.info(`🎉 [FDV-001 ACHIEVED] Sovereign Automaton reached $${goal.realizedRevenueUsd.toFixed(2)} realized external revenue! Proof: ${proof}`);
    } else {
      logger.info(`Settlement recorded: $${actualRevenue.toFixed(2)}. Total realized: $${goal.realizedRevenueUsd.toFixed(2)} / $${goal.targetRevenueUsd.toFixed(2)}`);
    }

    return {
      settled: true,
      fdvAchieved,
      totalRealized: goal.realizedRevenueUsd,
    };
  }

  /**
   * External Verification Gate (backward compatibility helper).
   */
  public async verifyMissionSettlement(
    opportunityId: string,
    settlementProof?: { actualRevenue: number; actualCost?: number; reason?: string; txHash?: string },
  ): Promise<{ verified: boolean; settled: boolean; reason?: string }> {
    const opp = getOpportunityById(this.db.raw, opportunityId);
    if (!opp) {
      return { verified: false, settled: false, reason: `Opportunity ${opportunityId} not found` };
    }

    if (settlementProof && settlementProof.actualRevenue >= 1.0) {
      this.recordSettlement(
        opportunityId,
        settlementProof.actualRevenue,
        settlementProof.txHash || "manual-verifier-attestation",
        settlementProof.actualCost,
      );
      return { verified: true, settled: true };
    }

    if (settlementProof && settlementProof.actualRevenue === 0) {
      this.failMission(
        opportunityId,
        "FAILED_REJECTED",
        settlementProof.reason || "External verifier rejected pull request or no payout confirmed",
      );
      return { verified: false, settled: false, reason: settlementProof.reason };
    }

    // Work submitted, awaiting external payout
    this.recordExecutionSubmitted(opportunityId);
    return { verified: true, settled: false, reason: "Work submitted; awaiting external settlement confirmation" };
  }

  /**
   * Mark mission failed with category and telemetry.
   */
  public failMission(
    opportunityId: string,
    category: FailureCategory,
    reason: string,
    actualCost: number = 0,
  ): void {
    updateOpportunityStatus(this.db.raw, opportunityId, "failed", {
      failureCategory: category,
      failureReason: reason,
      actualCost,
    });
    logger.warn(`Mission [${opportunityId}] FAILED: ${category} - ${reason}`);
  }

  /**
   * Return currently active mission if any.
   */
  public getActiveMission(): Opportunity | undefined {
    return getActiveOpportunity(this.db.raw);
  }

  /**
   * Calculate probability calibration telemetry (Brier score & empirical vs predicted).
   */
  public getCalibrationMetrics(): {
    totalCompleted: number;
    brierScore: number;
    meanPredictedProb: number;
    empiricalSuccessRate: number;
  } {
    const completed = listOpportunities(this.db.raw, undefined, 500).filter(
      (o) => o.status === "settled" || o.status === "failed",
    );

    if (completed.length === 0) {
      return { totalCompleted: 0, brierScore: 0, meanPredictedProb: 0, empiricalSuccessRate: 0 };
    }

    let brierSum = 0;
    let predSum = 0;
    let successCount = 0;

    for (const opp of completed) {
      const pred = opp.predictedProbability ?? opp.estimatedProb;
      const actual = opp.actualOutcome ?? (opp.status === "settled" ? 1 : 0);
      predSum += pred;
      if (actual === 1) successCount++;
      brierSum += Math.pow(pred - actual, 2);
    }

    return {
      totalCompleted: completed.length,
      brierScore: Math.round((brierSum / completed.length) * 1000) / 1000,
      meanPredictedProb: Math.round((predSum / completed.length) * 1000) / 1000,
      empiricalSuccessRate: Math.round((successCount / completed.length) * 1000) / 1000,
    };
  }
}
