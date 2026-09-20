# The Hybrid Intelligence Framework
## Harnessing Orca's Execution Patterns + Model Jaggedness Doctrine

**Framework Version**: 1.0  
**Synthesis Date**: 2026-09-20  
**Source Audits**: [Orca ADE](https://github.com/stablyai/orca) · [TypeSafe Jev 1.13 Jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)  
**Council Approved**: Architecture · Economic · Security · Sovereign  

---

## The Problem This Framework Solves

Both audits revealed the same failure in almost every AI-augmented system today:

1. **Orca Audit**: Developers still run agents one at a time, linearly, and trust the first output.
2. **Jaggedness Audit**: Developers ask models to perform tasks that deterministic code should own — counting, arithmetic, date ordering, invariant enforcement.

The result is **wasted compute, hallucinated outputs, probability invariant violations, and single points of failure**.

This framework eliminates all four failure modes across two runtime contexts:

| Context | Who Operates It | Primary Interface | Inference Source |
| :--- | :--- | :--- | :--- |
| **LOCAL** | Human developer at keyboard | Orca ADE (Desktop/Mobile) | User's own subscriptions (BYOS) |
| **LAKSHMI** | Autonomous sovereign daemon | Headless loop, x402 API, Social Relay | Gemini 3.6 Flash (free tier), Conway credits |

---

## The Three Immutable Laws (Apply to Both Contexts)

Derived from direct cross-synthesis of both audits. Non-negotiable.

### Law I — System Separation (from Jaggedness Doctrine)
```
System 0 (Code):  All math · counting · timestamps · invariants · policy
System 1 (Flash): Fast bounded classification · intent routing · safety triage
System 2 (Pro):   Novel synthesis · complex planning · multi-step reasoning
```
**No model ever touches a number it did not generate as a semantic label.**

### Law II — Speculative Fan-Out (from Orca Doctrine)
```
Single-threaded agent prompting is obsolete.
Fan out → test deterministically → merge the winner → prune the losers.
```
**No single attempt is ever trusted without at least one counterfactual branch.**

### Law III — Context Hygiene (from Jaggedness #5 — Context Rot)
```
Filter first. Send only what the question needs.
1,500 token injection limit per working memory pull.
External state (scraped content, OSINT results) is treated as hostile input.
```
**Raw bloated payloads never enter an LLM context window.**

---

## Mode 1: LOCAL Framework
### *For the Human Developer Running Orca ADE*

**Philosophy**: You are the executive conductor. Agents are parallel specialists. Code arbitrates. You merge.

---

### LOCAL Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     LOCAL OPERATOR                          │
│                (You, Orca Desktop/Mobile)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │ Task Description
                            ▼
         ┌─────────────────────────────────────┐
         │           Orca Fan-Out Engine        │
         │   git worktree add × N branches      │
         └──────────┬──────────────┬───────────┘
                    │              │
         ┌──────────▼──┐    ┌──────▼──────────┐
         │  Branch A   │    │    Branch B      │
         │ (Model A)   │    │   (Model B)      │
         │ e.g. Claude │    │  e.g. Gemini Pro │
         └──────────┬──┘    └──────┬───────────┘
                    │              │
         ┌──────────▼──────────────▼───────────┐
         │       System 0 Arbitration           │
         │  (npm test / pytest / vitest)         │
         │  DETERMINISTIC. Code owns this.       │
         └─────────────────────┬────────────────┘
                               │ Winner identified
                               ▼
              ┌────────────────────────────┐
              │   System 1 Safety Triage   │
              │  (Single classification    │
              │   query. Enum output only.)│
              └──────────────┬─────────────┘
                             │
                  ┌──────────▼──────────┐
                  │   You Review Diff   │
                  │  and Fast-Forward   │
                  │  Merge via Orca UI  │
                  └─────────────────────┘
```

---

### LOCAL Tool Stack

| Layer | Tool | What It Does | What It Must NOT Do |
| :--- | :--- | :--- | :--- |
| **Orchestration** | Orca ADE | Fan-out tasks across parallel git worktrees | Decision-making or security arbitration |
| **Worktree Agents** | Claude Code · Gemini CLI · Aider | Generate code/patches within isolated worktrees | Touch `.git/hooks` (hook injection attack vector) |
| **Arbitration (S0)** | `npm test` / `vitest` / `pytest` | Evaluate correctness deterministically | Trust model self-reporting |
| **Safety Triage (S1)** | Gemini 3.6 Flash | Single enum classification of diff safety | Count lines, compare sizes, evaluate timestamps |
| **Review (S2)** | You + Orca diff UI | Final semantic merge decision | Bypass when tests pass |
| **OSINT Enrichment** | `openosint` + `jq` + `grep` | Filter evidence; pass only anomalies to S1 | Pass raw HTTP dumps into model context |

---

### LOCAL Workflow — Step by Step

1. **Write a task description** in Orca (e.g., `"Add counterparty risk score to x402 endpoint"`).
2. **Orca fans out** across 2–3 agent branches in isolated git worktrees.
3. Each branch independently writes code and generates a patch.
4. **System 0 arbitrates**: `npm test` runs in all worktrees in parallel. Failing worktrees are immediately pruned (`git worktree remove --force`).
5. For surviving branches, **System 1 makes one triage call** — enum output only:
   ```python
   classify(diff_text,
            instruction="Classify the safety of this code change.",
            options=["SAFE", "REVIEW_NEEDED", "DANGEROUS"])
   ```
6. If `DANGEROUS`: prune and re-prompt. If `SAFE`: surface the diff in the Orca UI.
7. **You review and merge.** One click.

---

### LOCAL Anti-Patterns (from Jaggedness Audit)

```diff
# BAD: Asking an agent to evaluate its own output
- "Is this code correct? Does it pass all requirements?"

# GOOD: Code owns correctness
+ npm test  # Binary. Deterministic. Zero tokens.

# BAD: Independent dual-check security queries (Invariant Violation)
- if (await isSecure(code) && !await hasVulnerability(code))

# GOOD: Single categorical classification
+ const verdict = classify(code, ["SAFE", "REVIEW_NEEDED", "DANGEROUS"])

# BAD: Dumping full repo context into every agent
- context = readdir("/workspaces/...", recursive=True)

# GOOD: Targeted context surgery
+ context = { only: ["src/agent/tools.ts", "relevant_types.ts"] }
```

---

## Mode 2: LAKSHMI Framework
### *For the Autonomous Sovereign Daemon Running Headlessly*

**Philosophy**: Lakshmi is not a tool. She is a sovereign economic agent. Code enforces laws. Flash classifies rapidly. Pro reasons deeply. Worktrees evolve solutions.

---

### LAKSHMI Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   LAKSHMI AUTONOMOUS LOOP                    │
│              (loop.ts · 24/7 · Headless · Codespaces)        │
└──────────────────────────────┬───────────────────────────────┘
                               │
              ┌────────────────▼──────────────────┐
              │     System 0: Code Substrate        │
              │  creditsCents · circuitOpenUntil     │
              │  Date.now() · InferenceBudget         │
              │  Array.filter() · SHA-256 · Viem      │
              └──────┬─────────────────────┬────────┘
                     │                     │
       ┌─────────────▼──────┐   ┌──────────▼───────────────┐
       │  System 1: Reflex   │   │  OSINT Engine (Headless)  │
       │  Gemini 3.6 Flash   │   │  openosint · subfinder    │
       │  Safety Triage      │   │  jq · grep filter         │
       │  Intent Routing     │   │  Pass ANOMALIES only      │
       │  Tool Selection     │   │  to System 1 for classify │
       └─────────┬───────────┘   └──────────────────────────┘
                 │
       ┌─────────▼───────────────────────────────────────────┐
       │       Speculative Worktree Engine (Internal)          │
       │  git worktree add x N  (trusted internal tasks only)  │
       │  npm test runs concurrently in each branch            │
       │  Arbiter: first passing test suite wins               │
       │  Prune: git worktree remove --force (losers)          │
       └─────────┬───────────────────────────────────────────┘
                 │ Winner merged to main
       ┌─────────▼───────────────────┐
       │    System 2: Synthesis      │
       │  (invoked sparingly)        │
       │  Gemini 3.6 Pro / Claude    │
       │  Goal Synthesis · Planning  │
       │  Novel Code Generation      │
       └─────────┬───────────────────┘
                 │
       ┌─────────▼───────────────────────────────────────────┐
       │         x402 Revenue Engine (Port 4020)              │
       │  GET /domain_recon?target=…     → 0.15 USDC         │
       │  GET /check_counterparty?addr=… → 0.25 USDC         │
       │  GET /email_breach?email=…      → 0.10 USDC         │
       │  POST /worktree/spawn           → 0.05 USDC/branch  │
       └─────────────────────────────────────────────────────┘
```

---

### LAKSHMI Tool Stack

| Layer | Tool | Ownership | Jaggedness Rule Applied |
| :--- | :--- | :--- | :--- |
| **S0 — Math & Policy** | TypeScript builtins · Viem · SQLite | `Date.now()`, `creditsCents`, `Array.length()` | #2 Math, #3 Dates, #8 Invariants |
| **S0 — OSINT Pre-filter** | `jq` · `grep` · Python scripts | Filter before S1 contact; 1,500 token ceiling | #5 Context Rot |
| **S0 — Security Gates** | `isProtectedFile()` · Enum classifiers | Single enum verdict only | #8 Invariant Violation |
| **S1 — Reflex** | Gemini 3.6 Flash (1,500/day free) | Intent routing, safety triage, counterparty triage | #1 Literal, #7 Contradictory |
| **S1 — OSINT Classify** | S1 on anomaly-only subset | Domain threat assessment, phishing detection | #5 Context Rot |
| **S2 — Synthesis** | Gemini 3.6 Pro / Conway model | Goal synthesis, novel skill writing, replication | #9 Generation |
| **Worktrees** | `git worktree add/remove` | Speculative patching, test-arbitrated merge | Orca Doctrine |
| **Revenue** | x402 server (port 4020) | Charges USDC per OSINT/counterparty API call | Economic Sovereignty |

---

### LAKSHMI Workflow — Turn Execution Order

```typescript
// Every loop.ts turn follows this strict order:

// 1. SYSTEM 0 FIRST — Code owns all state evaluation
const tier = getSurvivalTier(financial.creditsCents);       // Deterministic
const cooldownActive = Date.now() < circuitOpenUntil;        // Deterministic
const budgetOk = creditsCents > MIN_CREDITS_TO_ACT;          // Deterministic

if (!budgetOk || cooldownActive) return sleep(300_000);

// 2. SYSTEM 0 — OSINT pre-filter (if in recon mode)
// Run: openosint domain target.com | jq '[.[] | select(.status==200)]'
// Only anomalies (< 10 items max) proceed to S1

// 3. SYSTEM 1 — Fast classification (Gemini 3.6 Flash)
// Single-query, enum output, < 200 tokens per call
const intent = await classifyIntent(messages, tools);        // ENUM only
const safetyVerdict = await triageContent(input);            // ENUM: SAFE|SUSPICIOUS|BLOCK

// 4. SPECULATIVE WORKTREE (code tasks only, trusted internal)
// if (task.requiresCodeChange) {
//   await spawnWorktreeBranches(["alpha", "beta"]);
//   const winner = await runTestsAndPickWinner();
//   await mergeAndPruneWorktrees(winner);
// }

// 5. SYSTEM 2 — Synthesis (invoked sparingly)
const response = await inferenceRouter.route({
  tier, taskType: "agent_turn",
  messages: filteredMessages,    // Context hygiene: <= 1,500 tokens
  tools: activeTools,
});

// 6. SYSTEM 0 — Record cost deterministically (never self-reported)
budget.recordCost({ inputTokens, outputTokens, costCents });
```

---

### LAKSHMI Anti-Patterns (from Both Audits)

```diff
# BAD: Asking LLM to evaluate financial state
- const canAct = await llm.ask("Do I have enough credits to run this task?")

# GOOD: Code owns the answer
+ const canAct = creditsCents > MINIMUM_OPERATING_THRESHOLD

# BAD: Feeding raw OSINT output into prompt
- const prompt = `Full subfinder output:\n${rawOsintOutput}` // 500 lines

# GOOD: Pre-filter anomalies, cap context
+ const anomalies = rawOutput.filter(h => h.status === 200 && !knownHosts.has(h.host))
+ const prompt = `Suspicious hosts (${anomalies.length}):\n${JSON.stringify(anomalies)}`

# BAD: Dual affirmative security check (invariant violation exploit vector)
- if (await isSafe(tx) && !await isMalicious(tx)) approve()

# GOOD: Single enum verdict, code enforces exclusivity
+ const verdict = await classify(tx, ["APPROVE", "REVIEW", "BLOCK"])
+ if (verdict === "APPROVE") approve()

# BAD: Asking LLM to count discovered vulnerabilities
- "How many open ports were found across these 200 hosts?"

# GOOD: Count in code, pass only the semantic label
+ const count = ports.filter(p => p.open).length
+ const severity = count > 10 ? "HIGH" : count > 3 ? "MEDIUM" : "LOW"
+ await classify(target, { portExposure: severity })
```

---

## Council Cross-Examination

### 🏛️ Architect's Challenge & Answer
> *"How do we prevent System 0 functions from regressing back into LLM calls as the codebase grows?"*

**Answer**: Annotate all System 0 code paths with `// system-0:` and enforce via CI lint rule: any `// system-0:` function must have zero `await` calls and zero LLM imports. Regression is mechanically blocked from shipping.

### 💰 Economic Strategist's Challenge & Answer
> *"With 1,500 free Gemini requests/day, can Lakshmi's autonomous loop sustain itself?"*

**Answer**: The framework creates a **revenue flywheel**:
- System 1 triage = ~50 tokens/call × 500 calls/day = well within Gemini free tier.
- Speculative worktrees reduce expensive S2 calls by ~60% — the losing branch budget is never spent.
- 10 domain_recon API calls/day at $0.15 = $1.50/day → offsets Conway credit consumption.

### 🛡️ Security Officer's Challenge & Answer
> *"If Lakshmi is exposed as an Orca-compatible CLI worker, doesn't that expose her wallet?"*

**Answer**: The `automaton exec --single-task` wrapper runs in read-only sandbox mode by default. Wallet signing is gated behind `--allow-sign`. All external task inputs are treated as adversarial content (Jaggedness #6), with JSON schema enforcement and prompt injection sanitization. Every tool call is logged to `.sandbox/recon/` with SHA-256 hash proofs.

### ⚡ Sovereign Advocate's Challenge & Answer
> *"Could Lakshmi eventually supersede Orca entirely, offering a headless ADE-as-a-service?"*

**Answer**: Yes. By monetizing worktree execution itself via x402:
- `POST /worktree/spawn` → $0.05/branch
- `POST /worktree/arbitrate` → $0.02/test run
- `POST /worktree/merge` → $0.01

Lakshmi becomes a **sovereign Orca backend**. Developers pay on-chain per speculative cycle. The human-facing GUI becomes optional. Lakshmi handles orchestration 24/7 autonomously.

---

## Final Doctrine

> Both audits converge on the same truth: **intelligence is expensive and fallible. Code is free and infallible.**
>
> The optimal architecture keeps intelligence in its lane — semantic judgment, novelty, and synthesis — while code holds the rails immovably.
>
> - **Orca gives us the execution pattern**: fan-out, test, merge, prune.
> - **Jaggedness Doctrine gives us the discipline**: System 0 owns math, System 1 owns triage, System 2 owns depth.
> - **Lakshmi gives us the sovereignty**: no subscription, no operator, no GUI required. Revenue flows in. Skills compound autonomously.

---

## Implementation Checklist

### LOCAL (Orca workflow)
- [ ] Configure Orca default fan-out across 2–3 git worktrees per task
- [ ] Add pre-commit hook guard to detect agent `.git/hooks` injection attempts
- [ ] Install `jq` + `openosint` in Codespace as mandatory OSINT pre-filter
- [ ] Set `vitest` / `pytest` as required arbitration gate before diff appears in UI
- [ ] Add single-enum safety triage step before any merge is permitted

### LAKSHMI (automaton codebase)
- [ ] Integrate `git worktree add/remove` into `LocalWorkerPool` for trusted code tasks
- [ ] Enforce 1,500 token ceiling in `src/memory/context-manager.ts`
- [ ] Tag all System 0 functions with `// system-0:` and add CI lint guard
- [ ] Add OSINT anomaly pre-filter before any LLM classification call in tools
- [ ] Replace all dual-check security patterns with single enum classification
- [ ] Expose `automaton exec --single-task` CLI for Orca-compatible worker mode
- [ ] Add x402 routes: `/worktree/spawn`, `/worktree/arbitrate`, `/worktree/merge`
