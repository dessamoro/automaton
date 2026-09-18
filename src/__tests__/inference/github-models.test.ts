import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInferenceClient } from "../../conway/inference.js";

describe("GitHub Models Free Tier Integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GITHUB_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
  });

  it("automatically routes to Azure AI endpoint when GITHUB_TOKEN is present", async () => {
    process.env.GITHUB_TOKEN = "ghp_test_token_12345";

    let interceptedUrl = "";
    let interceptedAuth = "";
    let interceptedBody: any = null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      interceptedUrl = String(url);
      interceptedAuth = init?.headers?.Authorization || "";
      interceptedBody = JSON.parse(init?.body as string);

      return {
        ok: true,
        json: async () => ({
          id: "chatcmpl-github-1",
          model: "gpt-4o-mini",
          choices: [
            {
              message: { role: "assistant", content: "Hello from GitHub Models!" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      } as any;
    });

    const client = createInferenceClient({
      apiUrl: "https://api.conway.tech",
      apiKey: "dummy",
      defaultModel: "gpt-4o-mini",
      maxTokens: 2048,
    });

    const response = await client.chat([{ role: "user", content: "Hi" }]);

    expect(interceptedUrl).toContain("models.inference.ai.azure.com/v1/chat/completions");
    expect(interceptedAuth).toBe("Bearer ghp_test_token_12345");
    expect(interceptedBody.model).toBe("gpt-4o-mini");
    expect(response.message.content).toBe("Hello from GitHub Models!");
  });
});
