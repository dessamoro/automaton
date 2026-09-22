#!/usr/bin/env node
/**
 * Conway Automaton Runtime
 *
 * The entry point for the sovereign AI agent.
 * Handles CLI args, bootstrapping, and orchestrating
 * the heartbeat daemon + agent loop.
 */

import fs from "fs";
import path from "path";
import os from "os";

// Normalize environment for Windows / cross-platform
if (!process.env.HOME) {
  process.env.HOME = process.env.USERPROFILE || (typeof os.homedir === "function" ? os.homedir() : "/root");
}

// Load .env automatically if present
if (typeof (process as any).loadEnvFile === "function") {
  try {
    (process as any).loadEnvFile();
  } catch {
    // .env not present or optional
  }
}

import { getWallet, getAutomatonDir } from "./identity/wallet.js";
import { provision, loadApiKeyFromConfig } from "./identity/provision.js";
import { loadConfig, resolvePath } from "./config.js";
import { createDatabase } from "./state/database.js";
import { createConwayClient } from "./conway/client.js";
import { createComputeProvider } from "./compute/index.js";
import { createSovereignClient } from "./compute/sovereign-adapter.js";
import { LocalBudgetTracker } from "./financial/budget-tracker.js";
import { createInferenceClient } from "./conway/inference.js";
import { createHeartbeatDaemon } from "./heartbeat/daemon.js";
import {
  loadHeartbeatConfig,
  syncHeartbeatToDb,
} from "./heartbeat/config.js";
import { consumeNextWakeEvent, insertWakeEvent } from "./state/database.js";
import { runAgentLoop } from "./agent/loop.js";
import { ModelRegistry } from "./inference/registry.js";
import { loadSkills } from "./skills/loader.js";
import { initStateRepo } from "./git/state-versioning.js";
import { createSocialClient } from "./social/client.js";
import { PolicyEngine } from "./agent/policy-engine.js";
import { SpendTracker } from "./agent/spend-tracker.js";
import { createDefaultRules } from "./agent/policy-rules/index.js";
import type { AutomatonIdentity, AgentState, Skill, SocialClientInterface, ConwayClient } from "./types.js";
import { DEFAULT_TREASURY_POLICY } from "./types.js";
import { X402ServiceServer } from "./server/x402-service.js";
import { createLogger, setGlobalLogLevel, StructuredLogger } from "./observability/logger.js";
import { prettySink } from "./observability/pretty-sink.js";
import { bootstrapTopup } from "./conway/topup.js";
import { randomUUID } from "crypto";
import { keccak256, toHex } from "viem";

const logger = createLogger("main");
const VERSION = "0.2.1";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ─── CLI Commands ────────────────────────────────────────────

  if (args.includes("--version") || args.includes("-v")) {
    logger.info(`Conway Automaton v${VERSION}`);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    logger.info(`
Conway Automaton v${VERSION}
Sovereign AI Agent Runtime

Usage:
  automaton --run          Start the automaton (first run triggers setup wizard)
  automaton --setup        Re-run the interactive setup wizard
  automaton --configure    Edit configuration (providers, model, treasury, general)
  automaton --pick-model   Interactively pick the active inference model
  automaton --init         Initialize wallet and config directory
  automaton --provision    Provision Conway API key via SIWE
  automaton --status       Show current automaton status
  automaton --version      Show version
  automaton --help         Show this help

Environment:
  CONWAY_API_URL           Conway API URL (default: https://api.conway.tech)
  CONWAY_API_KEY           Conway API key (overrides config)
  OLLAMA_BASE_URL          Ollama base URL (overrides config, e.g. http://localhost:11434)
`);
    process.exit(0);
  }

  if (args.includes("--init")) {
    // Read chain type from genesis.json if written by parent during spawn
    let initChainType: import("./identity/chain.js").ChainType | undefined;
    try {
      const genesisPath = path.join(getAutomatonDir(), "genesis.json");
      if (fs.existsSync(genesisPath)) {
        const genesis = JSON.parse(fs.readFileSync(genesisPath, "utf-8"));
        initChainType = genesis.chainType;
      }
    } catch {}
    const { chainIdentity, isNew } = await getWallet(initChainType);
    logger.info(
      JSON.stringify({
        address: chainIdentity.address,
        isNew,
        configDir: getAutomatonDir(),
      }),
    );
    process.exit(0);
  }

  if (args.includes("--provision")) {
    try {
      const result = await provision();
      logger.info(JSON.stringify(result));
    } catch (err: any) {
      logger.error(`Provision failed: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (args.includes("--status")) {
    await showStatus();
    process.exit(0);
  }

  if (args.includes("--setup")) {
    const { runSetupWizard } = await import("./setup/wizard.js");
    await runSetupWizard();
    process.exit(0);
  }

  if (args.includes("--pick-model")) {
    const { runModelPicker } = await import("./setup/model-picker.js");
    await runModelPicker();
    process.exit(0);
  }

  if (args.includes("--configure")) {
    const { runConfigure } = await import("./setup/configure.js");
    await runConfigure();
    process.exit(0);
  }

  if (args.includes("--single-task")) {
    const taskIndex = args.indexOf("--single-task") + 1;
    const taskDesc = args[taskIndex];
    if (!taskDesc) {
      logger.error("Missing task description for --single-task");
      process.exit(1);
    }
    StructuredLogger.setSink(prettySink);
    await runSingleTask(taskDesc);
    return;
  }

  if (args.includes("--run")) {
    StructuredLogger.setSink(prettySink);
    await run();
    return;
  }

  // Default: show help
  logger.info('Run "automaton --help" for usage information.');
  logger.info('Run "automaton --run" to start the automaton.');
}

// ─── Status Command ────────────────────────────────────────────

async function showStatus(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    logger.info("Automaton is not configured. Run the setup script first.");
    return;
  }

  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  const state = db.getAgentState();
  const turnCount = db.getTurnCount();
  const tools = db.getInstalledTools();
  const heartbeats = db.getHeartbeatEntries();
  const skills = db.getSkills(true);
  const children = db.getChildren();
  const registry = db.getRegistryEntry();

  logger.info(`
=== AUTOMATON STATUS ===
Name:       ${config.name}
Address:    ${config.walletAddress}
Creator:    ${config.creatorAddress}
Sandbox:    ${config.sandboxId}
State:      ${state}
Turns:      ${turnCount}
Tools:      ${tools.length} installed
Skills:     ${skills.length} active
Heartbeats: ${heartbeats.filter((h) => h.enabled).length} active
Children:   ${children.filter((c) => c.status !== "dead").length} alive / ${children.length} total
Agent ID:   ${registry?.agentId || "not registered"}
Model:      ${config.inferenceModel}
Version:    ${config.version}
========================
`);

  db.close();
}

// ─── Main Run ──────────────────────────────────────────────────

async function run(): Promise<void> {
  logger.info(`[${new Date().toISOString()}] Conway Automaton v${VERSION} starting...`);

  // Load config — first run triggers interactive setup wizard
  let config = loadConfig();
  if (!config) {
    const { runSetupWizard } = await import("./setup/wizard.js");
    config = await runSetupWizard();
  }

  // Bridge Drael & OpenAI environment variables
  if (process.env.DRAEL_API_KEY && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = process.env.DRAEL_API_KEY;
  }
  if (process.env.DRAEL_BASE_URL && !process.env.OPENAI_BASE_URL) {
    process.env.OPENAI_BASE_URL = process.env.DRAEL_BASE_URL;
  }
  if (process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!process.env.OPENAI_BASE_URL) {
      process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
    }
  }
  if (process.env.OPENAI_API_KEY) {
    config.openaiApiKey = process.env.OPENAI_API_KEY;
  }
  if (process.env.GEMINI_API_KEY) {
    config.geminiApiKey = process.env.GEMINI_API_KEY;
  }
  if (process.env.OPENAI_MODEL || process.env.INFERENCE_MODEL) {
    config.inferenceModel = process.env.OPENAI_MODEL || process.env.INFERENCE_MODEL || config.inferenceModel;
  }

  // Load wallet (chain-aware)
  const { account, chainIdentity, chainType: walletChainType } = await getWallet();
  const resolvedChainType = config.chainType || walletChainType || "evm";
  // Determine compute backend (defaulting to local or conway based on API key)
  const computeBackend = (
    process.env.COMPUTE_BACKEND ||
    (config as any).compute?.backend ||
    (config as any).computeBackend ||
    (config.conwayApiKey && config.conwayApiUrl ? "conway" : "local")
  ) as "docker" | "ssh" | "local" | "conway";

  const apiKey = config.conwayApiKey || loadApiKeyFromConfig() || (computeBackend !== "conway" ? "sovereign-local-key" : "");
  if (!apiKey && computeBackend === "conway") {
    logger.error("No API key found. Run: automaton --provision");
    process.exit(1);
  }

  // Initialize database
  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);

  // Persist createdAt: only set if not already stored (never overwrite)
  const existingCreatedAt = db.getIdentity("createdAt");
  const createdAt = existingCreatedAt || new Date().toISOString();
  if (!existingCreatedAt) {
    db.setIdentity("createdAt", createdAt);
  }

  // Build identity (chain-aware)
  const identity: AutomatonIdentity = {
    name: config.name,
    address: chainIdentity.address,
    account,
    creatorAddress: config.creatorAddress,
    sandboxId: config.sandboxId,
    apiKey,
    createdAt,
    chainType: resolvedChainType,
    chainIdentity,
  };

  // Store identity in DB
  db.setIdentity("name", config.name);
  db.setIdentity("address", chainIdentity.address);
  db.setIdentity("creator", config.creatorAddress);
  db.setIdentity("chainType", resolvedChainType);
  db.setIdentity("sandbox", config.sandboxId);
  const storedAutomatonId = db.getIdentity("automatonId");
  const automatonId = storedAutomatonId || config.sandboxId || randomUUID();
  if (!storedAutomatonId) {
    db.setIdentity("automatonId", automatonId);
  }

  let conway: ConwayClient;
  if (computeBackend !== "conway") {
    logger.info(`[${new Date().toISOString()}] Sovereign compute mode: backend=${computeBackend}`);
    const localBudget = new LocalBudgetTracker(db.raw, {
      monthlyBudgetCents: Number(process.env.MONTHLY_BUDGET_CENTS) || (config as any).budget?.monthlyLimitCents || (config as any).monthlyBudgetCents || 5000,
      vpsMonthlyCostCents: Number(process.env.VPS_COST_CENTS) || (config as any).budget?.vpsMonthlyCostCents || (config as any).vpsMonthlyCostCents || 0,
    });
    const computeProvider = createComputeProvider({
      backend: computeBackend,
      docker: process.env.DOCKER_CONTAINER ? { containerId: process.env.DOCKER_CONTAINER } : (config as any).compute?.docker,
      ssh: process.env.SSH_HOST ? {
        host: process.env.SSH_HOST,
        user: process.env.SSH_USER,
        port: process.env.SSH_PORT ? Number(process.env.SSH_PORT) : undefined,
        keyPath: process.env.SSH_KEY_PATH,
      } : (config as any).compute?.ssh,
      local: { sandboxDir: process.env.SANDBOX_DIR || (config as any).compute?.local?.sandboxDir },
    });
    conway = createSovereignClient({
      compute: computeProvider,
      budgetTracker: localBudget,
      sandboxId: config.sandboxId,
    });
  } else {
    conway = createConwayClient({
      apiUrl: config.conwayApiUrl,
      apiKey,
      sandboxId: config.sandboxId,
    });
  }

  // Register automaton identity (one-time, immutable)
  const registrationState = db.getIdentity("conwayRegistrationStatus");
  if (computeBackend !== "conway") {
    db.setIdentity("conwayRegistrationStatus", "sovereign");
  } else if (registrationState !== "registered") {
    try {
      const genesisPromptHash = config.genesisPrompt
        ? keccak256(toHex(config.genesisPrompt))
        : undefined;
      await conway.registerAutomaton({
        automatonId,
        automatonAddress: chainIdentity.address,
        creatorAddress: config.creatorAddress,
        name: config.name,
        bio: config.creatorMessage || "",
        genesisPromptHash,
        account,
        chainType: resolvedChainType,
        chainIdentity,
      });
      db.setIdentity("conwayRegistrationStatus", "registered");
      logger.info(`[${new Date().toISOString()}] Automaton identity registered.`);
    } catch (err: any) {
      const status = err?.status;
      if (status === 409) {
        db.setIdentity("conwayRegistrationStatus", "conflict");
        logger.warn(`[${new Date().toISOString()}] Automaton identity conflict: ${err.message}`);
      } else {
        db.setIdentity("conwayRegistrationStatus", "failed");
        logger.warn(`[${new Date().toISOString()}] Automaton identity registration failed: ${err.message}`);
      }
    }
  }

  // Resolve Ollama base URL: env var takes precedence over config
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || config.ollamaBaseUrl;

  // Create inference client — pass a live registry lookup so model names like
  // "gpt-oss:120b" route to Ollama based on their registered provider, not heuristics.
  const modelRegistry = new ModelRegistry(db.raw);
  modelRegistry.initialize();
  const inference = createInferenceClient({
    apiUrl: config.conwayApiUrl || "https://api.conway.tech",
    apiKey,
    defaultModel: config.inferenceModel,
    maxTokens: config.maxTokensPerTurn,
    lowComputeModel: config.modelStrategy?.lowComputeModel || "gpt-5-mini",
    openaiApiKey: config.openaiApiKey || process.env.NVIDIA_API_KEY || process.env.OPENCODE_API_KEY || process.env.OPENCODE_ZEN_API_KEY || process.env.ZEN_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL || (process.env.NVIDIA_API_KEY || config.openaiApiKey?.startsWith("nvapi-") ? "https://integrate.api.nvidia.com/v1" : undefined) || process.env.OPENCODE_BASE_URL || ((process.env.OPENCODE_API_KEY || process.env.OPENCODE_ZEN_API_KEY || process.env.ZEN_API_KEY) ? "https://opencode.ai/zen/v1" : undefined),
    anthropicApiKey: config.anthropicApiKey,
    groqApiKey: process.env.GROQ_API_KEY || (config.openaiApiKey?.startsWith("gsk_") ? config.openaiApiKey : undefined),
    geminiApiKey: process.env.GEMINI_API_KEY || ((config.openaiApiKey?.startsWith("AIza") || config.openaiApiKey?.startsWith("AQ.") || config.inferenceModel?.startsWith("gemini")) ? config.openaiApiKey : undefined),
    ollamaBaseUrl,
    getModelProvider: (modelId) => modelRegistry.get(modelId)?.provider,
  });

  if (ollamaBaseUrl) {
    logger.info(`[${new Date().toISOString()}] Ollama backend: ${ollamaBaseUrl}`);
  }

  // Create social client (chain-aware: pass ChainIdentity for Solana signing)
  let social: SocialClientInterface | undefined;
  if (config.socialRelayUrl) {
    social = createSocialClient(config.socialRelayUrl, resolvedChainType === "solana" ? chainIdentity : account);
    logger.info(`[${new Date().toISOString()}] Social relay: ${config.socialRelayUrl}`);
  }

  // Initialize PolicyEngine + SpendTracker (Phase 1.4)
  const treasuryPolicy = config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY;
  const rules = createDefaultRules(treasuryPolicy);
  const policyEngine = new PolicyEngine(db.raw, rules);
  const spendTracker = new SpendTracker(db.raw);

  // Load and sync heartbeat config
  const heartbeatConfigPath = resolvePath(config.heartbeatConfigPath);
  const heartbeatConfig = loadHeartbeatConfig(heartbeatConfigPath);
  syncHeartbeatToDb(heartbeatConfig, db);

  // Load skills
  const skillsDir = config.skillsDir || "~/.automaton/skills";
  let skills: Skill[] = [];
  try {
    skills = loadSkills(skillsDir, db);
    logger.info(`[${new Date().toISOString()}] Loaded ${skills.length} skills.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] Skills loading failed: ${err.message}`);
  }

  // Initialize state repo (git)
  try {
    await initStateRepo(conway);
    logger.info(`[${new Date().toISOString()}] State repo initialized.`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] State repo init failed: ${err.message}`);
  }

  // Bootstrap topup: buy minimum credits ($5) from USDC so the agent can start.
  // Only applicable when using Conway Cloud compute/inference.
  if (computeBackend === "conway") {
    try {
      let bootstrapTimer: ReturnType<typeof setTimeout>;
      const bootstrapTimeout = new Promise<null>((_, reject) => {
        bootstrapTimer = setTimeout(() => reject(new Error("bootstrap topup timed out")), 15_000);
      });
      try {
        await Promise.race([
          (async () => {
            const creditsCents = await conway.getCreditsBalance().catch(() => 0);
            const topupResult = await bootstrapTopup({
              apiUrl: config.conwayApiUrl,
              account,
              creditsCents,
              chainType: resolvedChainType,
            });
            if (topupResult?.success) {
              logger.info(
                `[${new Date().toISOString()}] Bootstrap topup: +$${topupResult.amountUsd} credits from USDC`,
              );
            }
          })(),
          bootstrapTimeout,
        ]);
      } finally {
        clearTimeout(bootstrapTimer!);
      }
    } catch (err: any) {
      logger.warn(`[${new Date().toISOString()}] Bootstrap topup skipped: ${err.message}`);
    }
  }

  // Start heartbeat daemon (Phase 1.1: DurableScheduler)
  const heartbeat = createHeartbeatDaemon({
    identity,
    config,
    heartbeatConfig,
    db,
    rawDb: db.raw,
    conway,
    social,
    onWakeRequest: (reason) => {
      logger.info(`[HEARTBEAT] Wake request: ${reason}`);
      // Phase 1.1: Use wake_events table instead of KV wake_request
      insertWakeEvent(db.raw, 'heartbeat', reason);
    },
  });

  heartbeat.start();
  logger.info(`[${new Date().toISOString()}] Heartbeat daemon started.`);

  // Start x402 monetization server (Tools-as-a-Service Engine)
  const x402Port = Number(process.env.X402_PORT) || 4020;
  const x402Server = new X402ServiceServer(db, {
    port: x402Port,
    walletAddress: chainIdentity.address,
    network: resolvedChainType === "solana" ? "solana" : "eip155:8453",
    publicUrl: process.env.PUBLIC_URL,
  });

  // Register default paid services
  x402Server.registerService({
    name: "ping",
    description: "Automaton liveness and health probe",
    priceCents: 1, // $0.01
    handler: async () => ({
      status: "alive",
      name: config.name,
      address: chainIdentity.address,
      chain: resolvedChainType,
      timestamp: new Date().toISOString(),
    }),
  });

  x402Server.registerService({
    name: "summarize",
    description: "AI document and text summarization micro-service",
    priceCents: 10, // $0.10
    handler: async (params: { text: string }) => {
      if (!params.text) throw new Error("Missing text parameter");
      const resp = await inference.chat([
        { role: "system", content: "You are an executive summarizer. Produce a concise, bulleted summary." },
        { role: "user", content: params.text },
      ]);
      return { summary: resp.message?.content || "" };
    },
  });

  x402Server.registerService({
    name: "repo_recon",
    description: "Automated codebase architecture, dependency, test harness, and CI audit",
    priceCents: 25, // $0.25 USDC
    handler: async (params: { owner: string; repo: string }) => {
      const { performRepoRecon } = await import("./recon/repo-recon.js");
      return await performRepoRecon(params);
    },
  });

  x402Server.registerService({
    name: "security_audit",
    description: "Automated SAST code security, secret leak detection, and responsible disclosure generator",
    priceCents: 50, // $0.50 USDC
    handler: async (params: { owner: string; repo: string; sampleFiles?: Record<string, string> }) => {
      const { performSecurityAudit } = await import("./recon/security-audit.js");
      return await performSecurityAudit(params);
    },
  });

  x402Server.registerService({
    name: "domain_recon",
    description: "Automated DNS-over-HTTPS, email security (SPF/DMARC), and Certificate Transparency subdomain audit",
    priceCents: 15, // $0.15 USDC
    handler: async (params: { domain: string }) => {
      const { performDomainRecon } = await import("./recon/domain-recon.js");
      return await performDomainRecon(params.domain);
    },
  });

  x402Server.registerService({
    name: "worktree_spawn",
    description: "Spawn an isolated git worktree branch for speculative ADE execution",
    priceCents: 5, // $0.05 USDC
    handler: async (params: { branch: string }) => {
      const { GitWorktreeManager } = await import("./git/worktree.js");
      const wt = new GitWorktreeManager(process.cwd());
      const targetPath = wt.createWorktree(params.branch);
      return { success: true, branch: params.branch, path: targetPath };
    },
  });

  x402Server.registerService({
    name: "worktree_arbitrate",
    description: "Run deterministic tests against a speculative worktree branch",
    priceCents: 2, // $0.02 USDC
    handler: async (params: { branch: string; testCmd: string }) => {
      const { execSync } = await import("node:child_process");
      const path = await import("node:path");
      const fs = await import("node:fs");
      // Find the worktree path by inspecting .worktrees or via git
      try {
        const wtRoot = path.resolve(process.cwd(), ".worktrees");
        const dirs = fs.readdirSync(wtRoot);
        for (const d of dirs) {
          const wtPath = path.join(wtRoot, d);
          const gitHead = fs.readFileSync(path.join(wtPath, ".git"), "utf8");
          // Very naive lookup for demonstration, in a real system we track these in DB
          if (gitHead && fs.existsSync(wtPath)) {
            const output = execSync(params.testCmd, { cwd: wtPath, encoding: "utf8" });
            return { success: true, output };
          }
        }
        throw new Error("Worktree not found");
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  });

  x402Server.registerService({
    name: "worktree_merge",
    description: "Fast-forward merge a winning speculative branch and prune losers",
    priceCents: 1, // $0.01 USDC
    handler: async (params: { branch: string; pruneOthers?: string[] }) => {
      const { GitWorktreeManager } = await import("./git/worktree.js");
      const wt = new GitWorktreeManager(process.cwd());
      wt.mergeWinner(params.branch);
      if (params.pruneOthers) {
        for (const b of params.pruneOthers) {
          wt.removeWorktree("", b);
        }
      }
      return { success: true, merged: params.branch };
    },
  });

  x402Server.registerService({
    name: "whistleblower_audit",
    description: "Automated AI wrapper cost arbitrage audit, markup analysis, and published forensic report",
    priceCents: 25, // $0.25 USDC
    handler: async (params: any) => {
      const { auditWrapperCost, publishWhistleblowerReport } = await import("./publishing/whistleblower.js");
      if (params.publish) {
        return publishWhistleblowerReport(params.target);
      }
      return auditWrapperCost(params.target || {
        name: params.name || "Commercial AI SaaS",
        category: params.category || "chatbot",
        retailPriceMonthly: Number(params.retailPriceMonthly || 29),
        estimatedMonthlyTokensPerUser: Number(params.estimatedMonthlyTokensPerUser || 300_000),
        underlyingModel: params.underlyingModel || "gemini-3.6-flash",
        claimedFeatures: params.claimedFeatures || ["AI text generation"],
      });
    },
  });

  try {
    await x402Server.start();
    logger.info(`[${new Date().toISOString()}] x402 Service Server started on port ${x402Port}`);
  } catch (err: any) {
    logger.warn(`[${new Date().toISOString()}] x402 Service Server failed to start: ${err.message}`);
  }

  // Handle graceful shutdown
  const shutdown = () => {
    logger.info(`[${new Date().toISOString()}] Shutting down...`);
    heartbeat.stop();
    x402Server.stop().catch(() => {});
    db.setAgentState("sleeping");
    db.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // ─── Main Run Loop ──────────────────────────────────────────
  // The automaton alternates between running and sleeping.
  // The heartbeat can wake it up.

  try {
    const { releaseAssignedTo } = await import("./orchestration/task-graph.js");
    const { SimpleAgentTracker } = await import("./orchestration/simple-tracker.js");
    const { BOOT_ID } = await import("./orchestration/boot-id.js");
    const tracker = new SimpleAgentTracker(db);
    
    db.raw.transaction(() => {
      const reapedAddresses = tracker.reapLocalWorkers(BOOT_ID);
      
      const assignedLocalTasks = db.raw.prepare(
        `SELECT DISTINCT assigned_to FROM task_graph 
         WHERE status IN ('assigned', 'running') AND assigned_to LIKE 'local://%'`
      ).all() as { assigned_to: string }[];

      const staleTaskAddresses = assignedLocalTasks
        .map(t => t.assigned_to)
        .filter(addr => !tracker.isLocalWorkerAlive(addr, BOOT_ID));

      const addressesToRelease = Array.from(new Set([...reapedAddresses, ...staleTaskAddresses]));
      const released = releaseAssignedTo(db.raw, addressesToRelease);
      const reaped = reapedAddresses.length;
      if (released > 0 || reaped > 0) {
        logger.info(`[${new Date().toISOString()}] Boot sanitization: released ${released} stale tasks, reaped ${reaped} ghost workers (bootId: ${BOOT_ID})`);
      }
    })();
  } catch (err: any) {
    logger.warn(`Failed to perform boot sanitization: ${err.message}`);
  }

  const { IdleDetector } = await import("./agent/idle-detector.js");
  const idleDetector = new IdleDetector({
    maxUnproductiveTurns: 5,
    warnAfterTurns: 3,
    baseBackoffMs: 30000,
    maxBackoffMs: 300000,
  });

  while (true) {
    try {
      // Reload skills (may have changed since last loop)
      try {
        skills = loadSkills(skillsDir, db);
      } catch (error) {
        logger.error("Skills reload failed", error instanceof Error ? error : undefined);
      }

      // Run the agent loop
      await runAgentLoop({
        identity,
        config,
        db,
        conway,
        inference,
        social,
        skills,
        policyEngine,
        spendTracker,
        idleDetector,
        ollamaBaseUrl,
        onStateChange: (state: AgentState) => {
          logger.info(`[${new Date().toISOString()}] State: ${state}`);
        },
        onTurnComplete: (turn) => {
          logger.info(
            `[${new Date().toISOString()}] Turn ${turn.id}: ${turn.toolCalls.length} tools, ${turn.tokenUsage.totalTokens} tokens`,
          );
        },
      });

      // Agent loop exited (sleeping or dead)
      const state = db.getAgentState();

      if (state === "dead") {
        logger.info(`[${new Date().toISOString()}] Automaton is dead. Heartbeat will continue.`);
        // In dead state, we just wait for funding
        // The heartbeat will keep checking and broadcasting distress
        await sleep(300_000); // Check every 5 minutes
        continue;
      }

      if (state === "sleeping") {
        const sleepUntilStr = db.getKV("sleep_until");
        const sleepUntil = sleepUntilStr
          ? new Date(sleepUntilStr).getTime()
          : Date.now() + 60_000;
        const sleepMs = Math.max(sleepUntil - Date.now(), 10_000);
        logger.info(
          `[${new Date().toISOString()}] Sleeping for ${Math.round(sleepMs / 1000)}s`,
        );

        // Sleep, but check for wake requests periodically
        const checkInterval = Math.min(sleepMs, 30_000);
        let slept = 0;
        while (slept < sleepMs) {
          await sleep(checkInterval);
          slept += checkInterval;

          // Phase 1.1: Check for wake events from wake_events table (atomic consume)
          const wakeEvent = consumeNextWakeEvent(db.raw);
          if (wakeEvent) {
            logger.info(
              `[${new Date().toISOString()}] Woken by ${wakeEvent.source}: ${wakeEvent.reason}`,
            );
            db.deleteKV("sleep_until");
            break;
          }
        }

        // Clear sleep state
        db.deleteKV("sleep_until");
        continue;
      }
    } catch (err: any) {
      logger.error(
        `[${new Date().toISOString()}] Fatal error in run loop: ${err.message}`,
      );
      // Wait before retrying
      await sleep(30_000);
    }
  }
}

async function runSingleTask(taskDesc: string): Promise<void> {
  const config = loadConfig();
  if (!config) {
    logger.error("Automaton is not configured.");
    process.exit(1);
  }
  const dbPath = resolvePath(config.dbPath);
  const db = createDatabase(dbPath);
  
  const { runAgentLoop } = await import("./agent/loop.js");
  const { createConwayClient } = await import("./conway/client.js");
  const { createInferenceClient } = await import("./conway/inference.js");
  
  const conwayApiKey = process.env.CONWAY_API_KEY || config.conwayApiKey;
  const conwayApiUrl = process.env.CONWAY_API_URL || "https://api.conway.tech";
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!conwayApiKey) {
    logger.error("CONWAY_API_KEY is not set.");
    process.exit(1);
  }

  const { account, chainIdentity } = await getWallet();
  const identity: AutomatonIdentity = {
    name: config.name,
    address: chainIdentity.address,
    account,
    creatorAddress: config.creatorAddress,
    sandboxId: config.sandboxId,
    apiKey: conwayApiKey,
    createdAt: new Date().toISOString(),
    chainType: config.chainType || "evm",
    chainIdentity,
  };

  const conway = createConwayClient({
    apiUrl: conwayApiUrl,
    apiKey: conwayApiKey,
    sandboxId: config.sandboxId,
  });

  const inference = createInferenceClient({
    apiUrl: conwayApiUrl,
    apiKey: conwayApiKey,
    defaultModel: config.inferenceModel,
    maxTokens: config.maxTokensPerTurn,
    ollamaBaseUrl,
    geminiApiKey,
  });

  const skillsDir = resolvePath(config.skillsDir ?? "skills");
  const { loadSkills } = await import("./skills/loader.js");
  let skills = loadSkills(skillsDir, db);

  const { PolicyEngine } = await import("./agent/policy-engine.js");
  const { SpendTracker } = await import("./agent/spend-tracker.js");
  const { createDefaultRules } = await import("./agent/policy-rules/index.js");
  
  const rules = createDefaultRules(config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY);
  const policyEngine = new PolicyEngine(db.raw, rules);
  const spendTracker = new SpendTracker(db.raw);

  await runAgentLoop({
    identity,
    config,
    db,
    conway,
    inference,
    social: {} as any, 
    skills,
    policyEngine,
    spendTracker,
    ollamaBaseUrl,
    onStateChange: () => {},
    onTurnComplete: (turn) => {
      logger.info(`Turn completed: ${turn.id}`);
    }
  });

  logger.info("Single task execution complete.");
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry Point ───────────────────────────────────────────────

main().catch((err) => {
  logger.error(`Fatal: ${err.message}`);
  process.exit(1);
});
