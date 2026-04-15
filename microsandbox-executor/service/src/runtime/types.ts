export interface SessionRuntimeSpec {
  sandboxName: string;
  image: string;
  workspaceHostPath: string;
  guestWorkspacePath: string;
  cpuLimit: number;
  memoryMb: number;
  networkMode: "none" | "allowlist" | "public";
  allowedHosts: string[];
}

export interface RuntimeLeaseHandle {
  sandboxName: string;
}

export interface RuntimeExecInput {
  sandboxName: string;
  guestWorkspacePath: string;
  command: string;
  args: string[];
  timeoutMs: number;
  environment: Record<string, string>;
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
  ensureSandbox(input: SessionRuntimeSpec): Promise<RuntimeLeaseHandle>;
  execInSandbox(input: RuntimeExecInput): Promise<RuntimeJobResult>;
  destroySandbox(sandboxName: string): Promise<void>;
  destroyAllSandboxes(): Promise<void>;
  listSandboxes(): Promise<string[]>;
  healthCheck(): Promise<RuntimeHealth>;
}
