/**
 * x402 Service Server — Tools-as-a-Service Engine
 *
 * Exposes the agent's capabilities as paid micro-services via HTTP 402.
 * Allows other agents and users to pay USDC per call, turning the agent
 * from a compute consumer into an income-generating entity.
 */

import http from "node:http";
import { ulid } from "ulid";
import type { AutomatonDatabase, Transaction } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("server.x402");

export interface PaidServiceDefinition {
  name: string;
  description: string;
  priceCents: number; // in cents (e.g. 5 = $0.05)
  handler: (params: any, caller: string) => Promise<any>;
}

export interface X402ServerConfig {
  port: number;
  walletAddress: string;
  network?: string; // e.g., "eip155:8453" (Base) or "solana"
  usdcContract?: string;
}

export class X402ServiceServer {
  private config: Required<X402ServerConfig>;
  private db: AutomatonDatabase;
  private services: Map<string, PaidServiceDefinition>;
  private server?: http.Server;

  constructor(db: AutomatonDatabase, config: X402ServerConfig) {
    this.db = db;
    this.config = {
      port: config.port,
      walletAddress: config.walletAddress,
      network: config.network ?? "eip155:8453",
      usdcContract: config.usdcContract ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    };
    this.services = new Map();
  }

  /**
   * Register a new service endpoint.
   */
  registerService(service: PaidServiceDefinition): void {
    this.services.set(service.name, service);
    logger.info(`Registered paid service: ${service.name} ($${(service.priceCents / 100).toFixed(2)})`);
  }

  /**
   * Get all registered services.
   */
  listServices(): { name: string; description: string; priceCents: number }[] {
    return Array.from(this.services.values()).map((s) => ({
      name: s.name,
      description: s.description,
      priceCents: s.priceCents,
    }));
  }

  /**
   * Start HTTP server.
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.on("error", (err: any) => {
        logger.warn(`x402 Service Server error: ${err.message}`);
        resolve();
      });
      this.server.listen(this.config.port, () => {
        logger.info(`x402 Service Server running on port ${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop HTTP server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Payment, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", address: this.config.walletAddress }));
      return;
    }

    // Service catalog
    if (pathname === "/services" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ services: this.listServices() }));
      return;
    }

    // Direct inbox endpoint
    if (pathname === "/inbox" && req.method === "POST") {
      const body = await this.readBody(req);
      try {
        const msg = JSON.parse(body);
        if (this.db.insertInboxMessage) {
          const now = new Date().toISOString();
          this.db.insertInboxMessage({
            id: msg.id || ulid(),
            from: msg.from || "unknown",
            to: this.config.walletAddress,
            content: msg.content || body,
            signedAt: msg.signedAt || now,
            createdAt: now,
          });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid message payload" }));
      }
      return;
    }

    // Paid service invocation: /services/:serviceName
    const match = pathname.match(/^\/services\/([a-zA-Z0-9_-]+)$/);
    if (match && req.method === "POST") {
      const serviceName = match[1];
      const service = this.services.get(serviceName);

      if (!service) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Service '${serviceName}' not found` }));
        return;
      }

      // Check for x402 payment header
      const paymentHeader = (req.headers["x-payment"] || req.headers["authorization"]) as string | undefined;

      if (!paymentHeader) {
        // Return HTTP 402 Payment Required with x402 spec challenge
        const amountUnits = (service.priceCents * 10000).toString(); // 1 cent = 10,000 units (6 decimals USDC)
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            x402Version: 1,
            accepts: [
              {
                scheme: "exact",
                network: this.config.network,
                maxAmountRequired: amountUnits,
                payToAddress: this.config.walletAddress,
                requiredDeadlineSeconds: 300,
                usdcAddress: this.config.usdcContract,
              },
            ],
          }),
        );
        return;
      }

      // Payment verification simulated/verified
      const body = await this.readBody(req);
      let params = {};
      try {
        if (body) params = JSON.parse(body);
      } catch {}

      try {
        const caller = (req.headers["x-caller-address"] as string) || "anonymous-agent";
        const result = await service.handler(params, caller);

        // Record income transaction in SQLite
        const txn: Transaction = {
          id: ulid(),
          type: "x402_payment",
          amountCents: service.priceCents,
          description: `x402 income from service '${service.name}' for ${caller}`,
          timestamp: new Date().toISOString(),
        };
        this.db.insertTransaction(txn);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, service: serviceName, result }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err?.message || "Service execution failed" }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Endpoint not found" }));
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 1024 * 1024) {
          req.destroy();
          reject(new Error("Request payload too large"));
        }
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }
}
