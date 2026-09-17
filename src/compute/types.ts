/**
 * ComputeProvider — abstraction over sandbox execution environments.
 * Replaces the monolithic ConwayClient for compute operations.
 */

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PortMapping {
  port: number;
  url: string;       // publicly accessible URL
  protocol: string;  // "https" or "http"
}

export interface SandboxSpec {
  name: string;
  memoryMb: number;   // 512, 1024, 2048, 4096, 8192
  vcpu?: number;
  diskGb?: number;
  image?: string;     // Docker image or OS template
}

export interface SandboxInfo {
  id: string;
  name: string;
  status: "running" | "stopped" | "creating" | "error";
  memoryMb: number;
}

export interface ComputeProvider {
  /** Execute a shell command. */
  exec(cmd: string, timeoutMs?: number): Promise<ExecResult>;

  /** Write content to a file path inside the execution environment. */
  writeFile(filePath: string, content: string): Promise<void>;

  /** Read content from a file path inside the execution environment. */
  readFile(filePath: string): Promise<string>;

  /** Expose a port and return a public URL. */
  exposePort(port: number): Promise<PortMapping>;

  /** Remove a previously exposed port. */
  removePort(port: number): Promise<void>;

  /** Create a new sandbox (for child agents / isolation). */
  createSandbox(spec: SandboxSpec): Promise<string>; // returns sandbox ID

  /** Delete a sandbox. */
  deleteSandbox(id: string): Promise<void>;

  /** List all sandboxes. */
  listSandboxes(): Promise<SandboxInfo[]>;

  /** Provider name for logging. */
  readonly providerName: string;
}
