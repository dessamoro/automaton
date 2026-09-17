import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { calculateDividendSplit, DividendEngine } from "../../financial/dividends.js";
import { createDatabase } from "../../state/database.js";

describe("DividendEngine & Split Logic", () => {
  it("calculates 20/60/20 split correctly", () => {
    // $100 surplus (10,000 cents)
    const split = calculateDividendSplit(10000);
    expect(split.eligible).toBe(true);
    expect(split.dividendCents).toBe(2000); // 20%
    expect(split.reinvestmentCents).toBe(6000); // 60%
    expect(split.reserveCents).toBe(2000); // 20%
  });

  it("rejects distribution when surplus is below threshold", () => {
    const split = calculateDividendSplit(400); // $4.00 surplus, min is $5.00
    expect(split.eligible).toBe(false);
    expect(split.dividendCents).toBe(0);
    expect(split.reserveCents).toBe(400);
  });

  describe("DividendEngine execution", () => {
    let tmpDir: string;
    let dbPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dividend-test-"));
      dbPath = path.join(tmpDir, "state.db");
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("evaluates and distributes dividends into SQLite transactions and history", async () => {
      const db = createDatabase(dbPath);
      let transferCalledWith: { to: string; amount: number } | null = null;

      const engine = new DividendEngine({
        db,
        creatorAddress: "0x1111222233334444555566667777888899990000",
        transferExecutor: async (to, amount) => {
          transferCalledWith = { to, amount };
          return { success: true, txHash: "0xmocktxhash" };
        },
      });

      const dist = await engine.evaluateAndDistribute(5000); // $50 surplus
      expect(dist.status).toBe("distributed");
      expect(dist.dividendCents).toBe(1000); // $10 dividend
      expect(dist.reinvestmentCents).toBe(3000); // $30 reinvestment
      expect(dist.reserveCents).toBe(1000); // $10 reserve
      expect(dist.txHash).toBe("0xmocktxhash");

      expect(transferCalledWith).toEqual({
        to: "0x1111222233334444555566667777888899990000",
        amount: 1000,
      });

      // Verify transaction ledger
      const txns = db.getRecentTransactions(10);
      expect(txns.length).toBeGreaterThan(0);
      expect(txns[0].type).toBe("dividend_payout");
      expect(txns[0].amountCents).toBe(1000);

      // Verify history
      const history = engine.getDistributionHistory();
      expect(history.length).toBe(1);
      expect(history[0].id).toBe(dist.id);

      db.close();
    });
  });
});
