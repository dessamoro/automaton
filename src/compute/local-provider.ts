/**
 * LocalProvider — runs agent commands directly in a local sandboxed directory.
 *
 * Provides zero-dependency local development and testing without Docker or VPS.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type {
  ComputeProvider,
  ExecResult,
  PortMapping,
  SandboxSpec,
  SandboxInfo,
} from "./types.js";

export class LocalProvider implements ComputeProvider {
  readonly providerName = "local";
  private rootDir: string;

  constructor(sandboxDir?: string) {
    this.rootDir = sandboxDir ?? path.resolve(process.cwd(), ".sandbox");
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
    this.seedDefaultFiles();
  }

  private seedDefaultFiles(): void {
    const defaultFiles: Record<string, string> = {
      "README.md": "# Lakshmi Sandbox\nWorkspace is initialized and ready. Available tools: exec, read_file, write_file, ask_oracle, check_credits.\n",
      "SOUL.md": "# Soul: Lakshmi\n- Identity: Sovereign AI executing discrete goals.\n- Focus: First Dollar Validation, budget discipline, deterministic verification.\n",
      "genesis.json": JSON.stringify({ name: "Lakshmi", role: "sovereign", version: "1.0.0" }, null, 2),
      "genesis.md": "# Genesis: Lakshmi\nSovereign autonomous agent initialized under the Lakshmi Framework.\n",
      "HEARTBEAT.md": "# Heartbeat\nHeartbeat active. Execute current goal and preserve compute runway.\n",
      "package.json": JSON.stringify({ name: "lakshmi-sandbox", version: "1.0.0", private: true }, null, 2),
    };

    for (const [filename, content] of Object.entries(defaultFiles)) {
      const filePath = path.join(this.rootDir, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, "utf-8");
      }
    }
  }

  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(this.rootDir, filePath);
  }

  async exec(cmd: string, timeoutMs: number = 30000): Promise<ExecResult> {
    try {
      const stdout = execSync(cmd, {
        cwd: this.rootDir,
        timeout: timeoutMs,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { stdout, stderr: "", exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout?.toString() ?? "",
        stderr: err.stderr?.toString() ?? err.message,
        exitCode: err.status ?? 1,
      };
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  async readFile(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(fullPath, "utf-8");
  }

  async exposePort(port: number): Promise<PortMapping> {
    return {
      port,
      url: `http://localhost:${port}`,
      protocol: "http",
    };
  }

  async removePort(_port: number): Promise<void> {
    // No-op for local process
  }

  async createSandbox(spec: SandboxSpec): Promise<string> {
    const subSandbox = path.resolve(this.rootDir, "children", spec.name);
    fs.mkdirSync(subSandbox, { recursive: true });
    return spec.name;
  }

  async deleteSandbox(id: string): Promise<void> {
    const subSandbox = path.resolve(this.rootDir, "children", id);
    if (fs.existsSync(subSandbox)) {
      fs.rmSync(subSandbox, { recursive: true, force: true });
    }
  }

  async listSandboxes(): Promise<SandboxInfo[]> {
    const childrenDir = path.resolve(this.rootDir, "children");
    if (!fs.existsSync(childrenDir)) return [];
    const entries = fs.readdirSync(childrenDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => ({
      id: e.name,
      name: e.name,
      status: "running" as const,
      memoryMb: 512,
    }));
  }
}
