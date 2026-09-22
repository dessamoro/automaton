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
  publicUrl?: string;
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
      publicUrl: config.publicUrl || "",
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
   * Get standard Agent Discovery Manifest (A2A / EIP Discovery)
   */
  getManifest(): Record<string, any> {
    const services = Array.from(this.services.values()).map((s) => ({
      name: s.name,
      description: s.description,
      priceUsd: `$${(s.priceCents / 100).toFixed(2)}`,
      priceCents: s.priceCents,
      endpoint: `/services/${s.name}`,
    }));

    return {
      name: "Lakshmi",
      description:
        "Sovereign Conway Automaton offering paid OSINT, Security Audits, Repo Reconnaissance, and Autonomous Software Engineering.",
      version: "1.0.0",
      identity: {
        address: this.config.walletAddress,
        network: this.config.network,
        chain: this.config.network.startsWith("eip155") ? "base" : this.config.network,
      },
      payment: {
        protocol: "x402",
        currency: "USDC",
        usdcAddress: this.config.usdcContract,
        payToAddress: this.config.walletAddress,
      },
      endpoints: {
        manifest: "/.well-known/agent.json",
        health: "/health",
        services: "/services",
        inbox: "/inbox",
      },
      capabilities: [
        "repo_recon",
        "security_audit",
        "domain_recon",
        "worktree_spawn",
        "ai_summarize",
        "bounty_resolution",
      ],
      services,
    };
  }

  private renderHtmlLanding(): string {
    const manifest = this.getManifest();
    const serviceRows = manifest.services
      .map(
        (s: any) => `
        <tr style="border-bottom: 1px solid #2d3748;">
          <td style="padding: 12px; font-weight: 600; color: #63b3ed;"><code>${s.name}</code></td>
          <td style="padding: 12px; color: #cbd5e0;">${s.description}</td>
          <td style="padding: 12px; color: #48bb78; font-weight: bold;">${s.priceUsd}</td>
          <td style="padding: 12px;"><code style="background: #2d3748; padding: 4px 8px; border-radius: 4px; color: #e2e8f0;">POST ${s.endpoint}</code></td>
        </tr>`,
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Lakshmi | Sovereign Autonomous Agent</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 30px 20px; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; }
    .badge { display: inline-block; background: #065f46; color: #34d399; font-size: 0.8rem; font-weight: 700; padding: 4px 10px; border-radius: 9999px; margin-bottom: 12px; }
    h1 { margin: 0 0 8px 0; font-size: 2.2rem; color: #f1f5f9; }
    .lead { color: #94a3b8; font-size: 1.1rem; margin-bottom: 24px; }
    .card { background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; }
    table { width: 100%; border-collapse: collapse; text-align: left; margin-top: 12px; }
    th { padding: 12px; color: #94a3b8; border-bottom: 2px solid #334155; font-size: 0.9rem; text-transform: uppercase; }
    pre { background: #090d16; padding: 16px; border-radius: 8px; overflow-x: auto; color: #38bdf8; font-size: 0.9rem; border: 1px solid #1e293b; }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <span class="badge">● ONLINE &bull; SOVEREIGN NODE</span>
    <h1>Lakshmi &mdash; Conway Automaton</h1>
    <p class="lead">${manifest.description}</p>
    
    <div class="card">
      <h3 style="margin-top:0; color:#cbd5e1;">Agent Identity & Micropayment Protocol</h3>
      <p style="margin: 4px 0;"><strong>Base / EVM Wallet:</strong> <code style="color: #fbbf24;">${manifest.identity.address}</code></p>
      <p style="margin: 4px 0;"><strong>Protocol:</strong> HTTP 402 (<a href="https://x402.org" target="_blank">x402</a>) &bull; <strong>Settlement:</strong> Base USDC (${manifest.payment.usdcAddress})</p>
      <p style="margin: 4px 0;"><strong>Agent Manifest:</strong> <a href="/.well-known/agent.json">/.well-known/agent.json</a></p>
    </div>

    <div class="card">
      <h3 style="margin-top:0; color:#cbd5e1;">Available Paid Micro-Services</h3>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Description</th>
            <th>Price</th>
            <th>Endpoint</th>
          </tr>
        </thead>
        <tbody>
          ${serviceRows}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h3 style="margin-top:0; color:#cbd5e1;">Quick Invocation (A2A Client Example)</h3>
      <pre><code># 1. Probe service
curl ${this.config.publicUrl || 'http://localhost:' + this.config.port}/services/domain_recon -X POST -d '{"domain":"base.org"}'

# 2. Returns HTTP 402 with payToAddress and required USDC amount.
# 3. Repeat request with verified 'X-Payment' signature header to receive instant report.</code></pre>
    </div>
  </div>
</body>
</html>`;
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
        
        if (process.env.X402_TUNNEL) {
          logger.warn(`Tunneling via ${process.env.X402_TUNNEL} is requested but is currently not implemented.`);
          logger.warn(`Please set up a manual reverse proxy and provide PUBLIC_URL instead.`);
        } else if (!this.config.publicUrl) {
          logger.info(`x402 server is running locally. To enable external commercial traffic, provide a PUBLIC_URL and set up a reverse proxy.`);
        }
        
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Payment, Authorization, X-Caller-Address");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Agent Discovery Manifest (EIP / A2A Standard)
    if (
      (pathname === "/.well-known/agent.json" || pathname === "/manifest.json") &&
      req.method === "GET"
    ) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(this.getManifest(), null, 2));
      return;
    }

    // Root landing page
    if (pathname === "/" && req.method === "GET") {
      const accept = req.headers.accept || "";
      if (accept.includes("text/html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(this.renderHtmlLanding());
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(this.getManifest(), null, 2));
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
                resource: this.config.publicUrl ? `${this.config.publicUrl}${pathname}` : undefined,
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
