/**
 * SshProvider — runs agent commands on a remote VPS over SSH.
 *
 * Perfect for DigitalOcean, Hetzner, or any Linux VPS.
 */

import { execFileSync } from "child_process";
import type {
  ComputeProvider,
  ExecResult,
  PortMapping,
  SandboxSpec,
  SandboxInfo,
} from "./types.js";

export interface SshConfig {
  host: string;
  port?: number;
  user?: string;
  keyPath?: string;
}

export class SshProvider implements ComputeProvider {
  readonly providerName = "ssh";
  private sshArgs: string[];

  constructor(private config: SshConfig) {
    const user = config.user ?? "root";
    const port = config.port ?? 22;
    this.sshArgs = [
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=10",
      "-o", "ServerAliveInterval=30",
      "-p", String(port),
    ];
    if (config.keyPath) {
      this.sshArgs.push("-i", config.keyPath);
    }
    this.sshArgs.push(`${user}@${config.host}`);
  }

  async exec(cmd: string, timeoutMs: number = 30000): Promise<ExecResult> {
    try {
      const stdout = execFileSync("ssh", [...this.sshArgs, cmd], {
        timeout: timeoutMs,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
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
    // Send content via base64 decoding to safely preserve quotes, spaces, and line breaks
    const base64Data = Buffer.from(content, "utf-8").toString("base64");
    const cmd = `echo "${base64Data}" | base64 -d > "${filePath}"`;
    const res = await this.exec(cmd, 15000);
    if (res.exitCode !== 0) {
      throw new Error(`Failed to write ${filePath} over SSH: ${res.stderr}`);
    }
  }

  async readFile(filePath: string): Promise<string> {
    const result = await this.exec(`cat "${filePath}"`, 10000);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read ${filePath} over SSH: ${result.stderr}`);
    }
    return result.stdout;
  }

  async exposePort(port: number): Promise<PortMapping> {
    return {
      port,
      url: `http://${this.config.host}:${port}`,
      protocol: "http",
    };
  }

  async removePort(_port: number): Promise<void> {
    // Managed via VPS firewall / UFW
  }

  async createSandbox(spec: SandboxSpec): Promise<string> {
    const image = spec.image ?? "ubuntu:24.04";
    const result = await this.exec(
      `docker run -d --name ${spec.name} --memory=${spec.memoryMb}m ${image} sleep infinity`,
      30000
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create remote sandbox: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  async deleteSandbox(id: string): Promise<void> {
    await this.exec(`docker rm -f ${id}`, 10000);
  }

  async listSandboxes(): Promise<SandboxInfo[]> {
    const result = await this.exec(
      'docker ps -a --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}"',
      10000
    );
    if (result.exitCode !== 0) return [];
    return result.stdout.trim().split("\n").filter(Boolean).map(line => {
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
