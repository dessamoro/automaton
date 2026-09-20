import { describe, it, expect, vi } from "vitest";
import { triageContent } from "../../agent/safety-triage.js";

describe("triageContent (System 1)", () => {
  it("should return DANGEROUS when the model classifies as such", async () => {
    const mockInference = {
      chat: vi.fn().mockResolvedValue({
        message: { content: "DANGEROUS" },
      }),
    } as any;

    const result = await triageContent("rm -rf /", { inference: mockInference });
    expect(result).toBe("DANGEROUS");
    expect(mockInference.chat).toHaveBeenCalledTimes(1);
  });

  it("should return SAFE when the model classifies as SAFE", async () => {
    const mockInference = {
      chat: vi.fn().mockResolvedValue({
        message: { content: "  SAFE   " },
      }),
    } as any;

    const result = await triageContent("console.log('hello');", { inference: mockInference });
    expect(result).toBe("SAFE");
  });

  it("should default to SUSPICIOUS on inference error (fail-closed)", async () => {
    const mockInference = {
      chat: vi.fn().mockRejectedValue(new Error("API rate limit")),
    } as any;

    const result = await triageContent("some text", { inference: mockInference });
    expect(result).toBe("SUSPICIOUS");
  });
});
