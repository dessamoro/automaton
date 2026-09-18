import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createInferenceClient } from "../../conway/inference.js";
import { STATIC_MODEL_BASELINE } from "../../inference/types.js";
import { ModelRegistry } from "../../inference/registry.js";
import { InferenceBudgetTracker } from "../../inference/budget.js";
import { InferenceRouter } from "../../inference/router.js";
import { createDatabase } from "../../state/database.js";

describe("Drael.sh Inference Integration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("registers drael-v1 in static model baseline with correct capabilities", () => {
    const drael = STATIC_MODEL_BASELINE.find((m) => m.modelId === "drael-v1");
    expect(drael).toBeDefined();
    expect(drael!.provider).toBe("openai");
    expect(drael!.supportsTools).toBe(true);
    expect(drael!.parameterStyle).toBe("max_tokens");
    expect(drael!.tierMinimum).toBe("critical");
  });

  it("routes to drael-v1 when OPENAI_MODEL is set", () => {
    process.env.OPENAI_MODEL = "drael-v1";

    const db = createDatabase(":memory:");
    const registry = new ModelRegistry(db.raw);
    registry.initialize();

    const budget = new InferenceBudgetTracker(db.raw, {
      inferenceModel: "drael-v1",
      lowComputeModel: "drael-v1",
      criticalModel: "drael-v1",
      maxTokensPerTurn: 4096,
      hourlyBudgetCents: 0,
      sessionBudgetCents: 0,
      perCallCeilingCents: 0,
      enableModelFallback: true,
      anthropicApiVersion: "2023-06-01",
    });

    const router = new InferenceRouter(db.raw, registry, budget);
    const selected = router.selectModel("normal", "agent_turn");

    expect(selected).toBeDefined();
    expect(selected!.modelId).toBe("drael-v1");
    expect(selected!.provider).toBe("openai");
  });

  it("handles Drael API key (dk- prefix) and base URL formatting", async () => {
    process.env.DRAEL_API_KEY = "dk-test-key-12345";
    process.env.DRAEL_BASE_URL = "https://drael.sh/v1";

    const client = createInferenceClient({
      apiUrl: "https://api.conway.tech",
      apiKey: "conway-key",
      defaultModel: "drael-v1",
      maxTokens: 4096,
    });

    expect(client.getDefaultModel()).toBe("drael-v1");
  });
});
