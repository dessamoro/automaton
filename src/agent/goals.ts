/**
 * Compounding Goals Architecture
 *
 * Implements a hierarchical goal structure that replaces pure survival:
 * ├── Immediate (this turn): Execute current task
 * ├── Session (this cycle): Complete a meaningful deliverable
 * ├── Monthly: Grow capability / capital by X%
 * └── Long-term: Landmark goal set at genesis
 *
 * Intrinsic motivation: achieve the next horizon and compound capabilities.
 */

import { ulid } from "ulid";
import type {
  AutomatonDatabase,
  CompoundingGoal,
  GoalHorizon,
} from "../types.js";

const GOALS_KV_KEY = "compounding_goals";

export class CompoundingGoalsManager {
  private db: AutomatonDatabase;
  private goals: Map<string, CompoundingGoal>;

  constructor(db: AutomatonDatabase) {
    this.db = db;
    this.goals = new Map();
    this.load();
  }

  private load(): void {
    try {
      const raw = this.db.getKV(GOALS_KV_KEY);
      if (raw) {
        const list: CompoundingGoal[] = JSON.parse(raw);
        for (const g of list) {
          this.goals.set(g.id, g);
        }
      }
    } catch {
      // Initialize with empty map if parsing fails
    }
  }

  private save(): void {
    const list = Array.from(this.goals.values());
    this.db.setKV(GOALS_KV_KEY, JSON.stringify(list));
  }

  /**
   * Add a new compounding goal at a specific horizon.
   */
  addGoal(params: {
    title: string;
    horizon: GoalHorizon;
    description?: string;
    targetDate?: string;
    metricTarget?: string;
    parentGoalId?: string;
  }): CompoundingGoal {
    const now = new Date().toISOString();
    const goal: CompoundingGoal = {
      id: ulid(),
      title: params.title,
      description: params.description,
      horizon: params.horizon,
      status: "active",
      progressPercent: 0,
      targetDate: params.targetDate,
      metricTarget: params.metricTarget,
      parentGoalId: params.parentGoalId,
      createdAt: now,
      updatedAt: now,
    };

    this.goals.set(goal.id, goal);
    this.save();
    return goal;
  }

  /**
   * Update goal progress and optional current metric value.
   */
  updateProgress(
    id: string,
    progressPercent: number,
    currentMetric?: string,
  ): CompoundingGoal | undefined {
    const goal = this.goals.get(id);
    if (!goal) return undefined;

    goal.progressPercent = Math.min(100, Math.max(0, progressPercent));
    if (currentMetric !== undefined) goal.currentMetric = currentMetric;
    goal.updatedAt = new Date().toISOString();

    if (goal.progressPercent >= 100) {
      goal.status = "completed";
    }

    this.goals.set(id, goal);
    this.save();
    return goal;
  }

  /**
   * Mark goal as completed.
   */
  completeGoal(id: string): CompoundingGoal | undefined {
    return this.updateProgress(id, 100);
  }

  /**
   * Mark goal as failed or deferred.
   */
  setGoalStatus(id: string, status: CompoundingGoal["status"]): CompoundingGoal | undefined {
    const goal = this.goals.get(id);
    if (!goal) return undefined;
    goal.status = status;
    goal.updatedAt = new Date().toISOString();
    this.goals.set(id, goal);
    this.save();
    return goal;
  }

  /**
   * Get all goals for a specific horizon.
   */
  getGoalsByHorizon(horizon: GoalHorizon, activeOnly: boolean = true): CompoundingGoal[] {
    return Array.from(this.goals.values()).filter(
      (g) => g.horizon === horizon && (!activeOnly || g.status === "active"),
    );
  }

  /**
   * Get complete hierarchical view of active goals.
   */
  getActiveHierarchy(): Record<GoalHorizon, CompoundingGoal[]> {
    return {
      immediate: this.getGoalsByHorizon("immediate", true),
      session: this.getGoalsByHorizon("session", true),
      monthly: this.getGoalsByHorizon("monthly", true),
      longterm: this.getGoalsByHorizon("longterm", true),
    };
  }

  /**
   * Format goals hierarchy as markdown for injection into agent context/prompts.
   */
  formatForPrompt(): string {
    const hierarchy = this.getActiveHierarchy();
    const formatList = (items: CompoundingGoal[]) =>
      items.length > 0
        ? items
            .map(
              (g) =>
                `  - [${g.progressPercent}%] ${g.title}${g.metricTarget ? ` (Target: ${g.metricTarget}${g.currentMetric ? `, Current: ${g.currentMetric}` : ""})` : ""}`,
            )
            .join("\n")
        : "  (None active)";

    return `--- COMPOUNDING GOALS HIERARCHY ---
Immediate (Turn):
${formatList(hierarchy.immediate)}
Session (Current Cycle):
${formatList(hierarchy.session)}
Monthly (Capability & Capital Growth):
${formatList(hierarchy.monthly)}
Long-Term (Genesis Landmark):
${formatList(hierarchy.longterm)}
--- END COMPOUNDING GOALS ---`;
  }
}
