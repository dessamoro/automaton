import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { ensureBootMicroSkills, EMBEDDED_STARTER_SKILLS } from "../../skills/micro-skills.js";
import { parseSkillMd } from "../../skills/format.js";
import { getActiveSkillInstructions } from "../../skills/loader.js";
import type { Skill } from "../../types.js";

describe("Lakshmi Framework — Skills Engine", () => {
  const testDir = path.join(os.tmpdir(), "automaton-test-skills-" + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("seeds boot micro-skills into an empty skills directory", () => {
    ensureBootMicroSkills(testDir);

    const entries = fs.readdirSync(testDir);
    expect(entries.length).toBe(EMBEDDED_STARTER_SKILLS.length);
    expect(entries).toContain("local-environment");
    expect(entries).toContain("microservice-builder");
    expect(entries).toContain("ask-oracle-guide");
    expect(entries).toContain("error-recovery");
    expect(entries).toContain("bounty-hunter");

    // Verify SKILL.md exists in each
    for (const skill of EMBEDDED_STARTER_SKILLS) {
      const skillPath = path.join(testDir, skill.dirName, "SKILL.md");
      expect(fs.existsSync(skillPath)).toBe(true);
      const content = fs.readFileSync(skillPath, "utf-8");
      const parsed = parseSkillMd(content, skillPath);
      expect(parsed).not.toBeNull();
      expect(parsed?.name).toBe(skill.dirName);
      expect(parsed?.instructions.length).toBeGreaterThan(50);
      expect(parsed?.tier).toBeDefined();
    }
  });

  it("parses tier and max-tokens from YAML frontmatter", () => {
    const rawSkill = `---
name: test-skill
description: A test skill
tier: core
max-tokens: 150
---
Do something useful here.
`;
    const parsed = parseSkillMd(rawSkill, "/fake/path/SKILL.md");
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe("test-skill");
    expect(parsed?.tier).toBe("core");
    expect(parsed?.maxTokens).toBe(150);
  });

  it("prioritizes core skills over contextual skills in getActiveSkillInstructions", () => {
    const skills: Skill[] = [
      {
        name: "contextual-skill",
        description: "contextual",
        autoActivate: true,
        instructions: "Contextual instructions",
        source: "builtin",
        path: "/path/contextual/SKILL.md",
        enabled: true,
        installedAt: new Date().toISOString(),
        tier: "contextual",
      },
      {
        name: "core-skill",
        description: "core",
        autoActivate: true,
        instructions: "Core instructions",
        source: "builtin",
        path: "/path/core/SKILL.md",
        enabled: true,
        installedAt: new Date().toISOString(),
        tier: "core",
      },
    ];

    const output = getActiveSkillInstructions(skills);
    const coreIndex = output.indexOf("[SKILL: core-skill");
    const contextualIndex = output.indexOf("[SKILL: contextual-skill");

    expect(coreIndex).toBeGreaterThanOrEqual(0);
    expect(contextualIndex).toBeGreaterThanOrEqual(0);
    // core must appear before contextual
    expect(coreIndex).toBeLessThan(contextualIndex);
  });
});
