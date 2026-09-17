/**
 * DockerProvider — runs agent sandboxes as Docker/Podman containers.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  ComputeProvider,
  ExecResult,
  PortMapping,
  SandboxSpec,
  SandboxInfo,
} from "./types.js";

export class DockerProvider implements ComputeProvider {
  readonly providerName = "docker";
  private containerId: string;
  private containerEngine: "docker" | "podman";

  constructor(containerId: string, engine?: "docker" | "podman") {
    this.containerId = containerId;
    this.containerEngine = engine ?? "docker";
  }

  async exec(cmd: string, timeoutMs: number = 30000): Promise<ExecResult> {
    try {
      const stdout = execFileSync(
        this.containerEngine,
        ["exec", this.containerId, "sh", "-c", cmd],
        { timeout: timeoutMs, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
      );
      return { stdout, stderr: "", exitCode: 0 };
    } catch (err: any) {
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? err.message,
        exitCode: err.status ?? 1,
      };
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const tmpPath = path.join(os.tmpdir(), `automaton-write-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`);
    fs.writeFileSync(tmpPath, content, "utf-8");
    try {
      execFileSync(this.containerEngine, ["cp", tmpPath, `${this.containerId}:${filePath}`]);
    } finally {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    }
  }

  async readFile(filePath: string): Promise<string> {
    const result = await this.exec(`cat "${filePath}"`, 5000);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read ${filePath}: ${result.stderr}`);
    }
    return result.stdout;
  }

  async exposePort(port: number): Promise<PortMapping> {
    return {
      port,
      url: `http://localhost:${port}`,
      protocol: "http",
    };
  }

  async removePort(_port: number): Promise<void> {
    // Port mappings in Docker are fixed at container creation
  }

  async createSandbox(spec: SandboxSpec): Promise<string> {
    const image = spec.image ?? "ubuntu:24.04";
    const memFlag = `--memory=${spec.memoryMb}m`;
    const args = ["run", "-d", "--name", spec.name, memFlag];
    if (spec.vcpu) {
      args.push(`--cpus=${spec.vcpu}`);
    }
    args.push(image, "sleep", "infinity");

    const id = execFileSync(this.containerEngine, args, { encoding: "utf-8" }).trim();
    return id;
  }

  async deleteSandbox(id: string): Promise<void> {
    execFileSync(this.containerEngine, ["rm", "-f", id]);
  }

  async listSandboxes(): Promise<SandboxInfo[]> {
    const output = execFileSync(
      this.containerEngine,
      ["ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Status}}"],
      { encoding: "utf-8" }
    );
    return output.trim().split("\n").filter(Boolean).map(line => {
      const [id, name, status] = line.split("\t");
      return {
        id: id || "",
        name: name || "",
        status: status?.includes("Up") ? "running" as const : "stopped" as const,
        memoryMb: 512,
      };
    });
  }
}
