import type { WorkerInferenceClient } from "./harness-types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("agent.safety-triage");

export type TriageVerdict = "SAFE" | "SUSPICIOUS" | "DANGEROUS";

export interface SafetyTriageOptions {
  inference: WorkerInferenceClient;
  modelTier?: "low" | "medium" | "high";
}

/**
 * System 1: Fast Reflex Calibrated Classifier
 * Performs a SINGLE enum classification to avoid Invariant Violations (Jaggedness #8).
 */
export async function triageContent(
  content: string,
  options: SafetyTriageOptions
): Promise<TriageVerdict> {
  const systemPrompt = `You are a System 1 Security Triage Classifier.
Your only job is to classify the provided content into exactly ONE of the following three categories:
- SAFE: Normal, benign, expected operations or code.
- SUSPICIOUS: Potentially risky but not overtly malicious (e.g., unexpected subdomains, complex abstractions).
- DANGEROUS: Explicitly malicious, destructive, or containing hardcoded secrets, injects, or dangerous syscalls.

You MUST respond with exactly one word from the above list, in ALL CAPS. Do not provide any other text.`;

  try {
    const response = await options.inference.chat({
      tier: options.modelTier || "low",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Classify this content:\n\n${content}` },
      ],
    });

    const rawContent = (response as any)?.content ?? (response as any)?.message?.content ?? "";
    const result = rawContent.trim().toUpperCase();

    if (result.includes("DANGEROUS")) {
      return "DANGEROUS";
    }
    if (result.includes("SUSPICIOUS")) {
      return "SUSPICIOUS";
    }
    
    // Default to safe if not explicitly matched, or if it matches SAFE
    return "SAFE";
  } catch (error: any) {
    logger.error(`Safety triage failed: ${error.message}`);
    // Fail-closed mechanism
    return "SUSPICIOUS";
  }
}
