import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createInferenceClient } from "../../conway/inference.js";
import { STATIC_MODEL_BASELINE } from "../../inference/types.js";
import { ModelRegistry } from "../../inference/registry.js";
import { InferenceBudgetTracker } from "../../inference/budget.js";
import { InferenceRouter } from "../../inference/router.js";
import { createDatabase } from "../../state/database.js";

describe("OpenRouter Free Tier Integration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("registers OpenRouter free models in static model baseline with zero cost", () => {
    const llama = STATIC_MODEL_BASELINE.find((m) => m.modelId === "meta-llama/llama-3.3-70b-instruct:free");
    expect(llama).toBeDefined();
    expect(llama!.provider).toBe("openai");
    expect(llama!.costPer1kInput).toBe(0);
    expect(llama!.costPer1kOutput).toBe(0);
    expect(llama!.parameterStyle).toBe("max_tokens");

    const qwen = STATIC_MODEL_BASELINE.find((m) => m.modelId === "qwen/qwen-2.5-coder-32b-instruct:free");
    expect(qwen).toBeDefined();
    expect(qwen!.provider).toBe("openai");
    expect(qwen!.costPer1kInput).toBe(0);
    expect(qwen!.costPer1kOutput).toBe(0);

    const r1 = STATIC_MODEL_BASELINE.find((m) => m.modelId === "deepseek/deepseek-r1:free");
    expect(r1).toBeDefined();
    expect(r1!.costPer1kInput).toBe(0);
    expect(r1!.costPer1kOutput).toBe(0);
  });

  it("routes to OpenRouter free model when OPENAI_MODEL is configured", () => {
    process.env.OPENAI_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

    const db = createDatabase(":memory:");
    const registry = new ModelRegistry(db.raw);
    registry.initialize();

    const budget = new InferenceBudgetTracker(db.raw, {
      inferenceModel: "meta-llama/llama-3.3-70b-instruct:free",
      lowComputeModel: "meta-llama/llama-3.3-70b-instruct:free",
      criticalModel: "meta-llama/llama-3.3-70b-instruct:free",
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
    expect(selected!.modelId).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(selected!.provider).toBe("openai");
  });

  it("initializes client with OpenRouter API key and defaults model correctly", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-abcdef1234567890";

    const client = createInferenceClient({
      apiUrl: "https://api.conway.tech",
      apiKey: "conway-key",
      defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
      maxTokens: 4096,
    });

    expect(client.getDefaultModel()).toBe("meta-llama/llama-3.3-70b-instruct:free");
  });
});
