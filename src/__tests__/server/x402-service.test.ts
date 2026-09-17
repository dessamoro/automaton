import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createDatabase } from "../../state/database.js";
import { X402ServiceServer } from "../../server/x402-service.js";

describe("X402ServiceServer", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: any;
  let server: X402ServiceServer;
  const PORT = 18402;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "x402-server-test-"));
    dbPath = path.join(tmpDir, "state.db");
    db = createDatabase(dbPath);

    server = new X402ServiceServer(db, {
      port: PORT,
      walletAddress: "0x1234567890123456789012345678901234567890",
    });

    server.registerService({
      name: "sentiment_analysis",
      description: "Analyze sentiment of text for 5 cents",
      priceCents: 5,
      handler: async (params: { text: string }) => {
        return { sentiment: "positive", score: 0.98, inputLength: params.text?.length || 0 };
      },
    });

    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    if (db) db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists registered services on GET /services", async () => {
    const res = await fetch(`http://localhost:${PORT}/services`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.services.length).toBe(1);
    expect(data.services[0].name).toBe("sentiment_analysis");
    expect(data.services[0].priceCents).toBe(5);
  });

  it("returns HTTP 402 with challenge when payment header is absent", async () => {
    const res = await fetch(`http://localhost:${PORT}/services/sentiment_analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello world!" }),
    });

    expect(res.status).toBe(402);
    const challenge = (await res.json()) as any;
    expect(challenge.x402Version).toBe(1);
    expect(challenge.accepts).toBeDefined();
    expect(challenge.accepts[0].payToAddress).toBe("0x1234567890123456789012345678901234567890");
    expect(challenge.accepts[0].maxAmountRequired).toBe("50000"); // 5 cents in 6-decimal units
  });

  it("executes service and returns 200 when payment header is present", async () => {
    const res = await fetch(`http://localhost:${PORT}/services/sentiment_analysis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Payment": "exact-receipt-proof-hash",
        "X-Caller-Address": "0xcaller999",
      },
      body: JSON.stringify({ text: "Super exciting milestone achieved!" }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.result.sentiment).toBe("positive");
    expect(data.result.inputLength).toBe(34);
  });
});
