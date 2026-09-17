import type { ComputeProvider } from "./types.js";
import { DockerProvider } from "./docker-provider.js";
import { SshProvider, type SshConfig } from "./ssh-provider.js";
import { LocalProvider } from "./local-provider.js";

export type ComputeBackend = "docker" | "ssh" | "local" | "conway";

export interface ComputeConfig {
  backend: ComputeBackend;
  docker?: { containerId: string; engine?: "docker" | "podman" };
  ssh?: SshConfig;
  local?: { sandboxDir?: string };
  conway?: { apiUrl: string; apiKey: string; sandboxId: string };
}

export function createComputeProvider(config: ComputeConfig): ComputeProvider {
  switch (config.backend) {
    case "docker":
      if (!config.docker) throw new Error("Docker config required for docker backend");
      return new DockerProvider(config.docker.containerId, config.docker.engine);
    case "ssh":
      if (!config.ssh) throw new Error("SSH config required for ssh backend");
      return new SshProvider(config.ssh);
    case "local":
      return new LocalProvider(config.local?.sandboxDir);
    case "conway":
      throw new Error("Conway provider: opt-in cloud backend");
    default:
      throw new Error(`Unknown compute backend: ${config.backend}`);
  }
}

export type {
  ComputeProvider,
  ExecResult,
  PortMapping,
  SandboxSpec,
  SandboxInfo,
} from "./types.js";
export { DockerProvider } from "./docker-provider.js";
export { SshProvider } from "./ssh-provider.js";
export { LocalProvider } from "./local-provider.js";
