/**
 * Sovereign ConwayClient Adapter
 *
 * Implements the ConwayClient interface by delegating compute operations
 * to a pluggable ComputeProvider (Docker, SSH, or Local) and financial operations
 * to the LocalBudgetTracker.
 *
 * This allows all existing tools, workflows, and tests to function seamlessly
 * in self-hosted mode without requiring Conway Cloud proprietary services.
 */

import type {
  ConwayClient,
  ExecResult,
  PortInfo,
  CreateSandboxOptions,
  SandboxInfo,
  PricingTier,
  CreditTransferResult,
  DomainSearchResult,
  DomainRegistration,
  DnsRecord,
  ModelInfo,
} from "../types.js";
import type { ComputeProvider } from "./types.js";
import type { LocalBudgetTracker } from "../financial/budget-tracker.js";

export interface SovereignClientOptions {
  compute: ComputeProvider;
  budgetTracker?: LocalBudgetTracker;
  sandboxId?: string;
}

export class SovereignClient implements ConwayClient {
  private compute: ComputeProvider;
  private budgetTracker?: LocalBudgetTracker;
  private sandboxId: string;

  constructor(options: SovereignClientOptions) {
    this.compute = options.compute;
    this.budgetTracker = options.budgetTracker;
    this.sandboxId = options.sandboxId ?? "sovereign-sandbox";
  }

  // ─── Compute Operations ──────────────────────────────────────────

  async exec(command: string, timeout?: number): Promise<ExecResult> {
    return this.compute.exec(command, timeout);
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.compute.writeFile(path, content);
  }

  async readFile(path: string): Promise<string> {
    return this.compute.readFile(path);
  }

  async exposePort(port: number): Promise<PortInfo> {
    const mapping = await this.compute.exposePort(port);
    return {
      port: mapping.port,
      publicUrl: mapping.url,
      sandboxId: this.sandboxId,
    };
  }

  async removePort(port: number): Promise<void> {
    return this.compute.removePort(port);
  }

  async createSandbox(options: CreateSandboxOptions): Promise<SandboxInfo> {
    const memoryMb = options.memoryMb ?? 1024;
    const name = `child-${Date.now().toString(36)}`;
    const id = await this.compute.createSandbox({
      name,
      memoryMb,
    });
    return {
      id,
      status: "running",
      region: "local",
      vcpu: options.vcpu ?? 1,
      memoryMb,
      diskGb: options.diskGb ?? 10,
      createdAt: new Date().toISOString(),
    };
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    return this.compute.deleteSandbox(sandboxId);
  }

  async listSandboxes(): Promise<SandboxInfo[]> {
    const list = await this.compute.listSandboxes();
    return list.map(s => ({
      id: s.id,
      status: s.status,
      region: "local",
      vcpu: 1,
      memoryMb: s.memoryMb,
      diskGb: 10,
      createdAt: new Date().toISOString(),
    }));
  }

  createScopedClient(targetSandboxId: string): ConwayClient {
    return new SovereignClient({
      compute: this.compute,
      budgetTracker: this.budgetTracker,
      sandboxId: targetSandboxId,
    });
  }

  // ─── Financial & Credits (Replaced by Local Budget) ───────────────

  async getCreditsBalance(): Promise<number> {
    if (this.budgetTracker) {
      return this.budgetTracker.getBudgetState().remainingCents;
    }
    return 100_000; // $1000 default if unbudgeted
  }

  async getCreditsPricing(): Promise<PricingTier[]> {
    return [
      {
        name: "Self-Hosted / Direct API",
        vcpu: 1,
        memoryMb: 1024,
        diskGb: 10,
        monthlyCents: 0,
      },
    ];
  }

  async transferCredits(
    toAddress: string,
    amountCents: number,
    note?: string,
  ): Promise<CreditTransferResult> {
    return {
      transferId: `local-tx-${Date.now()}`,
      status: "completed",
      toAddress,
      amountCents,
      balanceAfterCents: await this.getCreditsBalance(),
    };
  }

  async registerAutomaton(params: any): Promise<{ automaton: Record<string, unknown> }> {
    return {
      automaton: {
        id: params.automatonId,
        address: params.automatonAddress,
        name: params.name,
        sovereign: true,
      },
    };
  }

  // ─── Domain & DNS (Cloudflare / Self-hosted) ───────────────────────

  async searchDomains(query: string, tlds?: string): Promise<DomainSearchResult[]> {
    return [
      {
        domain: `${query}.is-a.dev`,
        available: true,
        registrationPrice: 0,
        currency: "USD",
      },
    ];
  }

  async registerDomain(domain: string, years?: number): Promise<DomainRegistration> {
    return {
      domain,
      status: "active",
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      transactionId: `tx-${Date.now()}`,
    };
  }

  async listDnsRecords(domain: string): Promise<DnsRecord[]> {
    return [];
  }

  async addDnsRecord(
    domain: string,
    type: string,
    host: string,
    value: string,
    ttl?: number,
  ): Promise<DnsRecord> {
    return {
      id: `rec-${Date.now()}`,
      type,
      host,
      value,
      ttl: ttl ?? 300,
    };
  }

  async deleteDnsRecord(domain: string, recordId: string): Promise<void> {
    // No-op for local mock
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "claude-sonnet-4",
        name: "Anthropic Claude 3.5/4 Sonnet",
        provider: "anthropic",
        contextWindow: 200000,
      } as any,
      {
        id: "gpt-4.1",
        name: "OpenAI GPT-4.1",
        provider: "openai",
        contextWindow: 128000,
      } as any,
      {
        id: "llama3.3:70b",
        name: "Ollama Llama 3.3 70B",
        provider: "ollama",
        contextWindow: 128000,
      } as any,
    ];
  }
}

export function createSovereignClient(options: SovereignClientOptions): ConwayClient {
  return new SovereignClient(options);
}
