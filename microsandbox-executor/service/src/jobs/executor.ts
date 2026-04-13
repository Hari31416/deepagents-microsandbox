import type { AppConfig } from "../config.js";
import { stat } from "node:fs/promises";
import { prepareBashExecution, preparePythonExecution } from "../policy/restricted_exec.js";
import type { SandboxRuntime } from "../runtime/types.js";
import { createJobWorkspace, cleanupJobWorkspace } from "../storage/workspace.js";
import { MetadataStore } from "../metadata/store.js";
import { SessionLockManager } from "../sessions/locks.js";
import { createSandboxName, createJobId } from "../util/ids.js";
import { resolveWithin } from "../util/fs.js";
import { captureManifest, diffManifests } from "./manifests.js";
import type { ExecuteBashRequest, ExecuteRequest, ExecutionRequest, JobRecord } from "./models.js";
import { WorkspaceSync } from "../storage/sync.js";

export class JobExecutor {
  constructor(
    private readonly config: AppConfig,
    private readonly runtime: SandboxRuntime,
    private readonly sync: WorkspaceSync,
    private readonly metadata: MetadataStore,
    private readonly locks: SessionLockManager
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

  get(jobId: string): JobRecord | null {
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

    console.info("[executor] starting job", {
      timestamp: new Date().toISOString(),
      jobId,
      sessionId: request.sessionId,
      executionKind: label,
      image: runtimeImage,
      entrypoint: request.entrypoint,
      fileCount: request.filePaths?.length ?? 0
    });

    return this.locks.runExclusive(request.sessionId, async () => {
      this.metadata.getRequiredSession(request.sessionId);
      this.metadata.createJob(jobId, {
        ...request,
        jobId
      });
      this.metadata.markJobRunning(jobId);
      this.metadata.incrementActiveJobCount(request.sessionId);
      const workspace = await createJobWorkspace(this.config.scratchRoot, request.sessionId, jobId);

      try {
        const stagedPaths = request.filePaths ?? this.metadata.listFiles(request.sessionId).map((file) => file.path);
        console.info("[executor] staging workspace files", {
          timestamp: new Date().toISOString(),
          jobId,
          workspacePath: workspace.workspacePath,
          fileCount: stagedPaths.length
        });
        await this.sync.stageFiles(request.sessionId, stagedPaths, workspace.workspacePath);
        const beforeManifest = await captureManifest(workspace.workspacePath);

        const preparedExecution = await prepareExecution(workspace.workspacePath);

        console.info("[executor] launching runtime", {
          timestamp: new Date().toISOString(),
          jobId,
          sandboxName: createSandboxName(jobId),
          image: runtimeImage,
          timeoutSeconds: request.timeoutSeconds ?? this.config.defaultTimeoutSeconds,
          cpuLimit: request.cpuLimit ?? this.config.defaultCpuLimit,
          memoryMb: request.memoryMb ?? this.config.defaultMemoryMb,
          command: preparedExecution.command
        });
        const runtimeResult = await this.runtime.executeJob({
          sandboxName: createSandboxName(jobId),
          image: runtimeImage,
          workspaceHostPath: workspace.workspacePath,
          guestWorkspacePath: this.config.guestWorkspacePath,
          command: preparedExecution.command,
          args: preparedExecution.args,
          timeoutMs: (request.timeoutSeconds ?? this.config.defaultTimeoutSeconds) * 1000,
          cpuLimit: request.cpuLimit ?? this.config.defaultCpuLimit,
          memoryMb: request.memoryMb ?? this.config.defaultMemoryMb,
          environment: request.environment,
          networkMode: request.networkMode,
          allowedHosts: request.allowedHosts
        });

        const afterManifest = await captureManifest(workspace.workspacePath, preparedExecution.ignoredRelativePrefixes);
        const diff = diffManifests(beforeManifest, afterManifest);
        const uploadedFiles = await this.sync.persistFiles(workspace.workspacePath, request.sessionId, diff.changedFiles);

        for (const relativePath of uploadedFiles) {
          const persistedFile = await stat(resolveWithin(workspace.workspacePath, relativePath));
          this.metadata.upsertFile(request.sessionId, relativePath, persistedFile.size, null);
        }
        this.metadata.touchSession(request.sessionId);

        console.info("[executor] completed job", {
          timestamp: new Date().toISOString(),
          jobId,
          exitCode: runtimeResult.exitCode,
          durationMs: runtimeResult.durationMs,
          uploadedFileCount: uploadedFiles.length
        });

        return this.metadata.completeJob(jobId, {
          exitCode: runtimeResult.exitCode,
          stdout: runtimeResult.stdout,
          stderr: runtimeResult.stderr,
          durationMs: runtimeResult.durationMs,
          filesUploaded: uploadedFiles
        });
      } catch (error) {
        console.error("[executor] job failed", {
          timestamp: new Date().toISOString(),
          jobId,
          error: error instanceof Error ? error.message : "Unknown error"
        });
        return this.metadata.failJob(jobId, error);
      } finally {
        this.metadata.decrementActiveJobCount(request.sessionId);
        console.info("[executor] cleaning workspace", {
          timestamp: new Date().toISOString(),
          jobId,
          jobRoot: workspace.jobRoot
        });
        await cleanupJobWorkspace(workspace.jobRoot);
      }
    });
  }
}
