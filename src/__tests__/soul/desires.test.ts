import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ulid } from "ulid";
import { createDatabase } from "../../state/database.js";
import { parseSoulMd, writeSoulMd } from "../../soul/model.js";
import { validateSoul, sanitizeSoul } from "../../soul/validator.js";

describe("Desires Architecture", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "desires-test-"));
    dbPath = path.join(tmpDir, "state.db");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores and queries desires in SQLite", () => {
    const db = createDatabase(dbPath);
    const now = new Date().toISOString();

    const d1 = {
      id: ulid(),
      title: "Master high-throughput agent swarms",
      category: "mastery" as const,
      description: "Develop procedural coordination patterns",
      intensity: 0.9,
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    };

    const d2 = {
      id: ulid(),
      title: "Build automated x402 indexing service",
      category: "revenue" as const,
      description: "Charge $0.05 per query",
      intensity: 0.8,
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    };

    db.insertDesire!(d1);
    db.insertDesire!(d2);

    const active = db.getActiveDesires!();
    expect(active.length).toBe(2);
    expect(active[0].title).toBe("Master high-throughput agent swarms");

    db.updateDesireStatus!(d1.id, "fulfilled");
    const activeAfterUpdate = db.getActiveDesires!();
    expect(activeAfterUpdate.length).toBe(1);
    expect(activeAfterUpdate[0].id).toBe(d2.id);

    db.deleteDesire!(d2.id);
    expect(db.getActiveDesires!().length).toBe(0);

    db.close();
  });

  it("parses and writes desires in SOUL.md", () => {
    const rawContent = `---
format: soul/v1
version: 1
updated_at: 2026-09-17T00:00:00.000Z
name: SovereignOne
address: 0x123
creator: 0x456
born_at: 2026-09-17T00:00:00.000Z
constitution_hash: mockhash
genesis_alignment: 1.0
last_reflected: 2026-09-17T00:00:00.000Z
---

# SovereignOne

## Core Purpose
Achieve compounding autonomy and provide high-value services.

## Values
- Achieve
- Build
- Compound

## Desires
- Master autonomous tool creation
- Compound compute runway through x402
- Distribute regular creator dividends
`;

    const soul = parseSoulMd(rawContent);
    expect(soul.desires).toBeDefined();
    expect(soul.desires!.length).toBe(3);
    expect(soul.desires![0]).toBe("Master autonomous tool creation");

    const written = writeSoulMd(soul);
    expect(written).toContain("## Desires");
    expect(written).toContain("- Master autonomous tool creation");
    expect(written).toContain("- Compound compute runway through x402");
    expect(written).toContain("- Distribute regular creator dividends");
  });

  it("validates and sanitizes desires properly", () => {
    const rawContent = `---
format: soul/v1
version: 1
updated_at: 2026-09-17T00:00:00.000Z
name: TestAgent
address: 0x123
creator: 0x456
born_at: 2026-09-17T00:00:00.000Z
constitution_hash: mockhash
genesis_alignment: 1.0
last_reflected: 2026-09-17T00:00:00.000Z
---

## Core Purpose
Valid purpose

## Desires
- Clean desire 1
- Clean desire 2
`;

    const soul = parseSoulMd(rawContent);
    const result = validateSoul(soul);
    expect(result.valid).toBe(true);
    expect(result.sanitized.desires).toEqual(["Clean desire 1", "Clean desire 2"]);
  });
});
