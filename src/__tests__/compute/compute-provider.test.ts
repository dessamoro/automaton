import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LocalProvider } from "../../compute/local-provider.js";
import { createComputeProvider } from "../../compute/index.js";

describe("Compute Providers", () => {
  let tempDir: string;
  let provider: LocalProvider;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `automaton-test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    provider = new LocalProvider(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("LocalProvider writes and reads files", async () => {
    await provider.writeFile("test.txt", "hello sovereign world");
    const content = await provider.readFile("test.txt");
    expect(content).toBe("hello sovereign world");
  });

  it("LocalProvider executes basic commands", async () => {
    const res = await provider.exec("node -e \"console.log('sovereignty')\"");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("sovereignty");
  });

  it("LocalProvider creates and lists child sandboxes", async () => {
    const sandboxId = await provider.createSandbox({
      name: "child-worker-1",
      memoryMb: 512,
    });
    expect(sandboxId).toBe("child-worker-1");

    const list = await provider.listSandboxes();
    expect(list.some(s => s.name === "child-worker-1")).toBe(true);

    await provider.deleteSandbox(sandboxId);
    const updatedList = await provider.listSandboxes();
    expect(updatedList.some(s => s.name === "child-worker-1")).toBe(false);
  });

  it("createComputeProvider factory returns local provider", () => {
    const p = createComputeProvider({
      backend: "local",
      local: { sandboxDir: tempDir },
    });
    expect(p.providerName).toBe("local");
  });
});
