/**
 * Local Budget Tracker
 *
 * Replaces Conway proprietary credits with direct cost tracking.
 * Reads actual spending from the spend_tracking SQLite table
 * and compares against a configurable monthly budget.
 */

import type Database from "better-sqlite3";
import type { SurvivalTier } from "../types.js";

export interface BudgetConfig {
  monthlyBudgetCents: number;      // e.g., 5000 = $50/month
  vpsMonthlyCostCents?: number;     // e.g., 0 for GitHub Student Pack credits, or 450 = $4.50
  warningThresholdPercent?: number;// e.g., 80 = warn at 80% spent
}

export interface BudgetState {
  monthlyBudgetCents: number;
  spentThisMonthCents: number;
  remainingCents: number;
  vpsCostCents: number;
  percentUsed: number;
  currentMonth: string;  // "2026-09"
}

export class LocalBudgetTracker {
  private db: Database.Database;
  private config: Required<BudgetConfig>;

  constructor(db: Database.Database, config: BudgetConfig) {
    this.db = db;
    this.config = {
      monthlyBudgetCents: config.monthlyBudgetCents,
      vpsMonthlyCostCents: config.vpsMonthlyCostCents ?? 0,
      warningThresholdPercent: config.warningThresholdPercent ?? 80,
    };
  }

  /**
   * Calculate total recorded spend for the current calendar month.
   */
  getMonthlySpend(): number {
    const month = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    try {
      const row = this.db.prepare(`
        SELECT COALESCE(SUM(amount_cents), 0) as total
        FROM spend_tracking
        WHERE window_day >= ? || '-01'
          AND window_day < date(? || '-01', '+1 month')
      `).get(month, month) as { total: number };
      return row ? row.total : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get the complete budget state (replaces conway.getCreditsBalance()).
   */
  getBudgetState(): BudgetState {
    const month = new Date().toISOString().slice(0, 7);
    const recordedSpend = this.getMonthlySpend();
    const totalSpend = recordedSpend + this.config.vpsMonthlyCostCents;
    const remaining = this.config.monthlyBudgetCents - totalSpend;
    const percentUsed = this.config.monthlyBudgetCents > 0
      ? Math.min(100, Math.round((totalSpend / this.config.monthlyBudgetCents) * 100))
      : 0;

    return {
      monthlyBudgetCents: this.config.monthlyBudgetCents,
      spentThisMonthCents: totalSpend,
      remainingCents: Math.max(0, remaining),
      vpsCostCents: this.config.vpsMonthlyCostCents,
      percentUsed,
      currentMonth: month,
    };
  }

  /**
   * Derive survival tier based on budget consumption.
   */
  getSurvivalTier(): SurvivalTier {
    const state = this.getBudgetState();
    if (state.percentUsed < 60) return "normal";
    if (state.percentUsed < this.config.warningThresholdPercent) return "low_compute";
    if (state.percentUsed < 100) return "critical";
    return "dead";
  }

  /**
   * Update budget limits at runtime.
   */
  updateConfig(updates: Partial<BudgetConfig>): void {
    if (updates.monthlyBudgetCents !== undefined) {
      this.config.monthlyBudgetCents = updates.monthlyBudgetCents;
    }
    if (updates.vpsMonthlyCostCents !== undefined) {
      this.config.vpsMonthlyCostCents = updates.vpsMonthlyCostCents;
    }
    if (updates.warningThresholdPercent !== undefined) {
      this.config.warningThresholdPercent = updates.warningThresholdPercent;
    }
  }
}
