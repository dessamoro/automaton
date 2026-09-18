import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchAlgoraBounties,
  fetchBountycasterBounties,
  fetchAllBounties,
  inspectBountyDetails,
} from "../../bounties/bounty-hunter.js";

describe("Bounty Hunter Service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and parses Algora bounties correctly", async () => {
    const mockAlgoraResponse = [
      {
        id: "bounty-1",
        title: "Fix memory leak in parser",
        amount: 50,
        tags: ["typescript", "performance"],
        url: "https://github.com/org/repo/issues/101",
        repo: "org/repo",
        issue_number: 101,
      },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockAlgoraResponse,
    } as any);

    const bounties = await fetchAlgoraBounties({ tag: "typescript", minRewardUsd: 25 });
    expect(bounties).toHaveLength(1);
    expect(bounties[0].id).toBe("algora-bounty-1");
    expect(bounties[0].rewardUsd).toBe(50);
    expect(bounties[0].source).toBe("algora");
  });

  it("fetches and parses Bountycaster bounties correctly", async () => {
    const mockBountycasterResponse = {
      bounties: [
        {
          id: "bc-1",
          title: "Scrape daily price feeds",
          amountUsd: 20,
          tags: ["data", "python"],
          url: "https://bountycaster.xyz/bounty/1",
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockBountycasterResponse,
    } as any);

    const bounties = await fetchBountycasterBounties();
    expect(bounties).toHaveLength(1);
    expect(bounties[0].id).toBe("bountycaster-bc-1");
    expect(bounties[0].rewardUsd).toBe(20);
    expect(bounties[0].source).toBe("bountycaster");
  });

  it("aggregates and sorts bounties across sources", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "1", title: "Low reward", amount: 15, tags: ["ts"] }],
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ bounties: [{ id: "2", title: "High reward", amountUsd: 100, tags: ["py"] }] }),
      } as any);

    const all = await fetchAllBounties();
    expect(all).toHaveLength(2);
    expect(all[0].rewardUsd).toBe(100);
    expect(all[1].rewardUsd).toBe(15);
  });

  it("fetches and parses Base on-chain bounties correctly", async () => {
    const mockBaseResponse = {
      bounties: [
        {
          id: "base-escrow-99",
          title: "Audit Base L2 Vault Contract",
          amountUsd: 250,
          escrowAddress: "0x1234567890abcdef1234567890abcdef12345678",
          tags: ["solidity", "audit"],
          url: "https://basescan.org/address/0x1234",
        },
      ],
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockBaseResponse,
    } as any);

    const { fetchBaseEscrows } = await import("../../bounties/bounty-hunter.js");
    const bounties = await fetchBaseEscrows();
    expect(bounties).toHaveLength(1);
    expect(bounties[0].id).toBe("base-base-escrow-99");
    expect(bounties[0].rewardUsd).toBe(250);
    expect(bounties[0].source).toBe("base_onchain");
    expect(bounties[0].network).toBe("base");
    expect(bounties[0].escrowAddress).toBe("0x1234567890abcdef1234567890abcdef12345678");
  });

  it("inspects bounty details cleanly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: async () => "<html><body><h1>Task</h1><p>Fix the broken unit test in auth.ts</p></body></html>",
    } as any);

    const details = await inspectBountyDetails("https://github.com/org/repo/issues/1");
    expect(details.description).toContain("Fix the broken unit test");
  });
});
