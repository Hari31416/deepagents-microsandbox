export interface RuntimeJobInput {
  sandboxName: string;
  image: string;
  workspaceHostPath: string;
  guestWorkspacePath: string;
  command: string;
  args: string[];
  timeoutMs: number;
  cpuLimit: number;
  memoryMb: number;
  environment: Record<string, string>;
  networkMode: "none" | "allowlist" | "public";
  allowedHosts: string[];
}

export interface RuntimeJobResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface RuntimeHealth {
  ok: boolean;
  runtime: string;
  details: string;
}

export interface SandboxRuntime {
  executeJob(input: RuntimeJobInput): Promise<RuntimeJobResult>;
  healthCheck(): Promise<RuntimeHealth>;
}
