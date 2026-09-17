/**
 * Dividend Engine
 *
 * Implements sovereign capital allocation:
 * Surplus revenue is split between:
 * - 20% Creator Dividend (paid to creator's wallet)
 * - 60% Reinvestment (compute runway, tool capability, skill acquisition)
 * - 20% Reserve Fund (emergency buffer against low compute)
 */

import { ulid } from "ulid";
import type {
  AutomatonDatabase,
  DividendPolicy,
  DividendDistribution,
  Transaction,
} from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("financial.dividends");

export const DEFAULT_DIVIDEND_POLICY: DividendPolicy = {
  dividendPercent: 20,
  reinvestmentPercent: 60,
  reservePercent: 20,
  minSurplusCents: 500, // $5.00 minimum surplus before paying dividends
};

export interface SplitResult {
  surplusCents: number;
  dividendCents: number;
  reinvestmentCents: number;
  reserveCents: number;
  eligible: boolean;
  reason?: string;
}

/**
 * Calculate the distribution amounts based on policy percentages.
 */
export function calculateDividendSplit(
  surplusCents: number,
  customPolicy?: Partial<DividendPolicy>,
): SplitResult {
  const policy: DividendPolicy = { ...DEFAULT_DIVIDEND_POLICY, ...customPolicy };

  if (surplusCents < policy.minSurplusCents) {
    return {
      surplusCents,
      dividendCents: 0,
      reinvestmentCents: 0,
      reserveCents: surplusCents,
      eligible: false,
      reason: `Surplus ($${(surplusCents / 100).toFixed(2)}) is below minimum threshold ($${(policy.minSurplusCents / 100).toFixed(2)})`,
    };
  }

  const dividendCents = Math.floor((surplusCents * policy.dividendPercent) / 100);
  const reinvestmentCents = Math.floor((surplusCents * policy.reinvestmentPercent) / 100);
  const reserveCents = surplusCents - dividendCents - reinvestmentCents;

  return {
    surplusCents,
    dividendCents,
    reinvestmentCents,
    reserveCents,
    eligible: true,
  };
}

export type TransferExecutor = (toAddress: string, amountCents: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;

export class DividendEngine {
  private db: AutomatonDatabase;
  private creatorAddress: string;
  private policy: DividendPolicy;
  private transferExecutor?: TransferExecutor;

  constructor(params: {
    db: AutomatonDatabase;
    creatorAddress: string;
    policy?: Partial<DividendPolicy>;
    transferExecutor?: TransferExecutor;
  }) {
    this.db = params.db;
    this.creatorAddress = params.creatorAddress;
    this.policy = { ...DEFAULT_DIVIDEND_POLICY, ...params.policy };
    this.transferExecutor = params.transferExecutor;
  }

  /**
   * Evaluate surplus and trigger dividend distribution if eligible.
   */
  async evaluateAndDistribute(surplusCents: number): Promise<DividendDistribution> {
    const id = ulid();
    const timestamp = new Date().toISOString();
    const split = calculateDividendSplit(surplusCents, this.policy);

    if (!split.eligible) {
      logger.info("Dividend evaluation skipped", { reason: split.reason, surplusCents });
      return {
        id,
        surplusCents,
        dividendCents: 0,
        reinvestmentCents: 0,
        reserveCents: surplusCents,
        creatorAddress: this.creatorAddress,
        status: "skipped",
        reason: split.reason,
        timestamp,
      };
    }

    if (!this.creatorAddress) {
      logger.warn("Creator address not configured, skipping dividend payout");
      return {
        id,
        surplusCents,
        dividendCents: 0,
        reinvestmentCents: surplusCents - split.reserveCents,
        reserveCents: split.reserveCents,
        creatorAddress: "",
        status: "skipped",
        reason: "Creator address not set",
        timestamp,
      };
    }

    let txHash: string | undefined;
    if (this.transferExecutor) {
      try {
        const transferRes = await this.transferExecutor(this.creatorAddress, split.dividendCents);
        if (transferRes.success) {
          txHash = transferRes.txHash;
        } else {
          logger.error("Dividend transfer execution failed", undefined, { error: transferRes.error });
        }
      } catch (err: any) {
        logger.error("Error executing dividend transfer", err instanceof Error ? err : undefined, { error: String(err) });
      }
    }

    // Record in SQLite transaction ledger
    const txn: Transaction = {
      id,
      type: "dividend_payout",
      amountCents: split.dividendCents,
      description: `Creator dividend payout (${this.policy.dividendPercent}% of $${(surplusCents / 100).toFixed(2)} surplus)`,
      timestamp,
    };
    this.db.insertTransaction(txn);

    // Save dividend record to KV history
    const historyKey = "dividend_distributions";
    const historyStr = this.db.getKV(historyKey) || "[]";
    const history: DividendDistribution[] = JSON.parse(historyStr);

    const record: DividendDistribution = {
      id,
      surplusCents,
      dividendCents: split.dividendCents,
      reinvestmentCents: split.reinvestmentCents,
      reserveCents: split.reserveCents,
      creatorAddress: this.creatorAddress,
      txHash,
      status: "distributed",
      timestamp,
    };

    history.push(record);
    if (history.length > 50) history.shift();
    this.db.setKV(historyKey, JSON.stringify(history));

    logger.info("Dividend distributed successfully", {
      dividendCents: split.dividendCents,
      reinvestmentCents: split.reinvestmentCents,
      reserveCents: split.reserveCents,
      creator: this.creatorAddress,
    });

    return record;
  }

  /**
   * Get past dividend distribution history.
   */
  getDistributionHistory(): DividendDistribution[] {
    const historyStr = this.db.getKV("dividend_distributions") || "[]";
    try {
      return JSON.parse(historyStr);
    } catch {
      return [];
    }
  }
}
