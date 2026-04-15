import type { AppConfig } from "../config.js";
import type { MetadataStore } from "../metadata/types.js";
import { prepareBashExecution, preparePythonExecution } from "../policy/restricted_exec.js";
import type { SandboxRuntime } from "../runtime/types.js";
import { SessionLockManager } from "../sessions/locks.js";
import { SessionRuntimeManager } from "../sessions/runtime_manager.js";
import { createJobId } from "../util/ids.js";
import { captureManifest } from "./manifests.js";
import type { ExecuteBashRequest, ExecuteRequest, ExecutionRequest, JobRecord } from "./models.js";

export class JobExecutor {
  constructor(
    private readonly config: AppConfig,
    private readonly runtime: SandboxRuntime,
    private readonly metadata: MetadataStore,
    private readonly locks: SessionLockManager,
    private readonly runtimeManager: SessionRuntimeManager
  ) {}

  async execute(request: ExecuteRequest) {
    return this.executePreparedJob({
      request,
      runtimeImage: this.resolveRuntimeImage(request.pythonProfile),
      label: request.pythonProfile,
      prepareExecution: async (workspacePath) =>
        preparePythonExecution({
          workspacePath,
          entrypoint: request.entrypoint,
          code: request.code,
          enableRestrictedExec: request.restrictedExec ?? this.config.enableRestrictedExec,
          blockedImports: this.config.blockedImports
        })
    });
  }

  async executeBash(request: ExecuteBashRequest) {
    return this.executePreparedJob({
      request,
      runtimeImage: this.config.runtimeImages.default,
      label: "bash",
      prepareExecution: async (workspacePath) =>
        prepareBashExecution({
          workspacePath,
          entrypoint: request.entrypoint,
          script: request.script
        })
    });
  }

  async get(jobId: string): Promise<JobRecord | null> {
    return this.metadata.getJob(jobId);
  }

  private validateRequest(request: ExecutionRequest) {
    if ((request.timeoutSeconds ?? this.config.defaultTimeoutSeconds) > this.config.maxTimeoutSeconds) {
      throw new Error(`timeout_seconds exceeds max allowed value of ${this.config.maxTimeoutSeconds}`);
    }

    if ((request.cpuLimit ?? this.config.defaultCpuLimit) > this.config.maxCpuLimit) {
      throw new Error(`cpu_limit exceeds max allowed value of ${this.config.maxCpuLimit}`);
    }

    if ((request.memoryMb ?? this.config.defaultMemoryMb) > this.config.maxMemoryMb) {
      throw new Error(`memory_mb exceeds max allowed value of ${this.config.maxMemoryMb}`);
    }
  }

  private resolveRuntimeImage(profile: ExecuteRequest["pythonProfile"]) {
    return this.config.runtimeImages[profile ?? "default"] ?? this.config.runtimeImages.default;
  }

  private async executePreparedJob(options: {
    request: ExecuteRequest | ExecuteBashRequest;
    runtimeImage: string;
    label: string;
    prepareExecution: (workspacePath: string) => Promise<{
      command: string;
      args: string[];
      ignoredRelativePrefixes: string[];
    }>;
  }) {
    const { request, runtimeImage, label, prepareExecution } = options;
    const jobId = request.jobId ?? createJobId();
    this.validateRequest(request);
    const stagedPathsPreview = (request.filePaths ?? []).slice(0, 10);

    console.info("[executor] starting job", {
      timestamp: new Date().toISOString(),
      jobId,
      sessionId: request.sessionId,
      executionKind: label,
      image: runtimeImage,
      entrypoint: request.entrypoint,
      fileCount: request.filePaths?.length ?? 0,
      filePaths: stagedPathsPreview,
      payloadPreview: summarizeExecutionPayload(request)
    });

    return this.locks.runExclusive(request.sessionId, async () => {
      await this.metadata.getRequiredSession(request.sessionId);
      await this.metadata.createJob(jobId, {
        ...request,
        jobId
      });
      await this.metadata.markJobRunning(jobId);
      await this.metadata.incrementActiveJobCount(request.sessionId);

      const lease = await this.runtimeManager.ensureLease({
        sessionId: request.sessionId,
        image: runtimeImage,
        cpuLimit: request.cpuLimit ?? this.config.defaultCpuLimit,
        memoryMb: request.memoryMb ?? this.config.defaultMemoryMb,
        networkMode: request.networkMode,
        allowedHosts: request.allowedHosts
      });
      const beforeManifest = await captureManifest(lease.workspacePath, [], { hashAllFiles: true });

      let preparedExecution:
        | {
            command: string;
            args: string[];
            ignoredRelativePrefixes: string[];
          }
        | undefined;
      let runtimeResult:
        | {
            exitCode: number;
            stdout: string;
            stderr: string;
            durationMs: number;
          }
        | undefined;

      try {
        await this.runtimeManager.markLeaseDirty(request.sessionId, true);
        preparedExecution = await prepareExecution(lease.workspacePath);

        console.info("[executor] launching runtime", {
          timestamp: new Date().toISOString(),
          jobId,
          sandboxName: lease.sandboxName,
          image: runtimeImage,
          timeoutSeconds: request.timeoutSeconds ?? this.config.defaultTimeoutSeconds,
          cpuLimit: request.cpuLimit ?? this.config.defaultCpuLimit,
          memoryMb: request.memoryMb ?? this.config.defaultMemoryMb,
          command: preparedExecution.command,
          args: preparedExecution.args,
          payloadPreview: summarizeExecutionPayload(request)
        });
        runtimeResult = await this.runtime.execInSandbox({
          sandboxName: lease.sandboxName,
          guestWorkspacePath: this.config.guestWorkspacePath,
          command: preparedExecution.command,
          args: preparedExecution.args,
          timeoutMs: (request.timeoutSeconds ?? this.config.defaultTimeoutSeconds) * 1000,
          environment: request.environment
        });

        const persisted = await this.runtimeManager.persistWorkspaceChanges(
          request.sessionId,
          lease.workspacePath,
          beforeManifest,
          preparedExecution.ignoredRelativePrefixes
        );
        await this.metadata.touchSession(request.sessionId);

        console.info("[executor] completed job", {
          timestamp: new Date().toISOString(),
          jobId,
          exitCode: runtimeResult.exitCode,
          durationMs: runtimeResult.durationMs,
          uploadedFileCount: persisted.uploadedFiles.length,
          uploadedFiles: persisted.uploadedFiles.slice(0, 20),
          deletedFileCount: persisted.deletedFiles.length,
          stdoutPreview: summarizeOutput(runtimeResult.stdout),
          stderrPreview: summarizeOutput(runtimeResult.stderr)
        });

        return this.metadata.completeJob(jobId, {
          exitCode: runtimeResult.exitCode,
          stdout: runtimeResult.stdout,
          stderr: runtimeResult.stderr,
          durationMs: runtimeResult.durationMs,
          filesUploaded: persisted.uploadedFiles
        });
      } catch (error) {
        let filesUploaded: string[] = [];

        try {
          const persisted = await this.runtimeManager.persistWorkspaceChanges(
            request.sessionId,
            lease.workspacePath,
            beforeManifest,
            preparedExecution?.ignoredRelativePrefixes ?? []
          );
          filesUploaded = persisted.uploadedFiles;
        } catch (persistError) {
          error = new Error(
            `Execution failed and workspace flush also failed: ${formatError(error)}; flush error: ${formatError(
              persistError
            )}`
          );
        }

        console.error("[executor] job failed", {
          timestamp: new Date().toISOString(),
          jobId,
          error: formatError(error),
          payloadPreview: summarizeExecutionPayload(request)
        });
        return this.metadata.failJob(jobId, error, {
          exitCode: runtimeResult?.exitCode ?? null,
          stdout: runtimeResult?.stdout ?? "",
          stderr: runtimeResult?.stderr ?? formatError(error),
          durationMs: runtimeResult?.durationMs ?? null,
          filesUploaded
        });
      } finally {
        await this.metadata.decrementActiveJobCount(request.sessionId);
      }
    });
  }
}

function summarizeExecutionPayload(request: ExecuteRequest | ExecuteBashRequest) {
  if (request.kind === "bash") {
    return {
      kind: "bash",
      entrypoint: request.entrypoint,
      scriptPreview: summarizeText(request.script)
    };
  }

  return {
    kind: "python",
    entrypoint: request.entrypoint,
    pythonProfile: request.pythonProfile,
    codePreview: summarizeText(request.code)
  };
}

function summarizeOutput(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  return summarizeText(normalized, 240);
}

function summarizeText(value: string, maxLength = 320) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
