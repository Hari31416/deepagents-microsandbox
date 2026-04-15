import type { AppConfig } from "../config.js";
import { captureManifest, diffManifests, diffMetadataFiles, type WorkspaceManifest } from "../jobs/manifests.js";
import type { MetadataStore, SessionRuntimeLeaseRecord } from "../metadata/types.js";
import type { SandboxRuntime, SessionRuntimeSpec } from "../runtime/types.js";
import { WorkspaceSync } from "../storage/sync.js";
import type { SessionStorage } from "../storage/types.js";
import {
  cleanupSessionWorkspace,
  createSessionWorkspace,
  listSessionWorkspaceIds,
  resolveSessionWorkspacePaths
} from "../storage/workspace.js";
import { pathExists, resolveWithin, statWithin } from "../util/fs.js";
import { sha256File } from "../util/hash.js";
import { createSessionSandboxName } from "../util/ids.js";

export interface SessionRuntimeRequest {
  sessionId: string;
  image: string;
  cpuLimit: number;
  memoryMb: number;
  networkMode: "none" | "allowlist" | "public";
  allowedHosts: string[];
}

export interface PersistedWorkspaceResult {
  uploadedFiles: string[];
  deletedFiles: string[];
}

export class SessionRuntimeManager {
  constructor(
    private readonly config: AppConfig,
    private readonly runtime: SandboxRuntime,
    private readonly sync: WorkspaceSync,
    private readonly storage: SessionStorage,
    private readonly metadata: MetadataStore
  ) {}

  async reconcileStartup() {
    const leases = await this.metadata.listSessionRuntimes();
    const leaseBySessionId = new Map(leases.map((lease) => [lease.sessionId, lease]));
    const knownSandboxNames = new Set(leases.map((lease) => lease.sandboxName));
    const runningSandboxes = await this.runtime.listSandboxes();

    for (const sandboxName of runningSandboxes) {
      if (!knownSandboxNames.has(sandboxName)) {
        await this.runtime.destroySandbox(sandboxName);
      }
    }

    for (const lease of leases) {
      const session = await this.metadata.getSession(lease.sessionId);
      if (!session) {
        await this.runtime.destroySandbox(lease.sandboxName);
        await cleanupSessionWorkspace(resolveSessionWorkspacePaths(this.config.scratchRoot, lease.sessionId).sessionRoot);
        await this.metadata.deleteSessionRuntime(lease.sessionId);
        continue;
      }

      if (runningSandboxes.includes(lease.sandboxName)) {
        await this.runtime.destroySandbox(lease.sandboxName);
      }

      if (!(await pathExists(lease.workspacePath)) && lease.hydrated) {
        await this.metadata.upsertSessionRuntime({
          ...lease,
          hydrated: false,
          dirty: false,
          updatedAt: new Date().toISOString()
        });
      }
    }

    for (const sessionId of await listSessionWorkspaceIds(this.config.scratchRoot)) {
      const lease = leaseBySessionId.get(sessionId);
      if (!lease) {
        await cleanupSessionWorkspace(resolveSessionWorkspacePaths(this.config.scratchRoot, sessionId).sessionRoot);
      }
    }
  }

  async shutdown() {
    for (const lease of await this.metadata.listSessionRuntimes()) {
      await this.runtime.destroySandbox(lease.sandboxName);
    }
  }

  async ensureLease(request: SessionRuntimeRequest) {
    const workspace = await createSessionWorkspace(this.config.scratchRoot, request.sessionId);
    const existingLease = await this.metadata.getSessionRuntime(request.sessionId);
    let lease =
      existingLease ??
      this.buildLeaseRecord({
        ...request,
        workspacePath: workspace.workspacePath
      });

    if (!existingLease) {
      await this.metadata.upsertSessionRuntime(lease);
    } else if (!this.isCompatible(existingLease, request)) {
      await this.flushDirtyWorkspace(existingLease);
      await this.runtime.destroySandbox(existingLease.sandboxName);
      lease = {
        ...this.buildLeaseRecord({
          ...request,
          workspacePath: existingLease.workspacePath
        }),
        createdAt: existingLease.createdAt,
        hydrated: existingLease.hydrated,
        updatedAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString()
      };
      await this.metadata.upsertSessionRuntime(lease);
    }

    if (lease.dirty) {
      await this.flushDirtyWorkspace(lease);
      lease = (await this.metadata.getSessionRuntime(request.sessionId)) ?? {
        ...lease,
        dirty: false
      };
    }

    await this.reconcileWorkspaceFromStorage(request.sessionId, lease.workspacePath);
    await this.runtime.ensureSandbox(this.toRuntimeSpec(lease));

    const updatedLease: SessionRuntimeLeaseRecord = {
      ...lease,
      hydrated: true,
      updatedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    };
    await this.metadata.upsertSessionRuntime(updatedLease);
    return updatedLease;
  }

  async markLeaseDirty(sessionId: string, dirty: boolean) {
    const lease = await this.metadata.getSessionRuntime(sessionId);
    if (!lease) {
      return;
    }

    await this.metadata.upsertSessionRuntime({
      ...lease,
      dirty,
      updatedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    });
  }

  async mirrorUploadedFile(sessionId: string, relativePath: string, contents: Buffer) {
    const lease = await this.metadata.getSessionRuntime(sessionId);
    if (!lease || !(await pathExists(lease.workspacePath))) {
      return false;
    }

    await this.sync.writeWorkspaceFile(lease.workspacePath, relativePath, contents);
    await this.metadata.upsertSessionRuntime({
      ...lease,
      hydrated: true,
      updatedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    });
    return true;
  }

  async mirrorDeletedFile(sessionId: string, relativePath: string) {
    const lease = await this.metadata.getSessionRuntime(sessionId);
    if (!lease || !(await pathExists(lease.workspacePath))) {
      return false;
    }

    await this.sync.deleteWorkspaceFile(lease.workspacePath, relativePath);
    await this.metadata.upsertSessionRuntime({
      ...lease,
      updatedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    });
    return true;
  }

  async persistWorkspaceChanges(
    sessionId: string,
    workspacePath: string,
    beforeManifest: WorkspaceManifest,
    ignoredRelativePrefixes: string[]
  ): Promise<PersistedWorkspaceResult> {
    const afterManifest = await captureManifest(workspacePath, ignoredRelativePrefixes, { hashAllFiles: true });
    const diff = diffManifests(beforeManifest, afterManifest);
    await this.persistDiff(sessionId, workspacePath, afterManifest, diff.changedFiles, diff.deletedFiles);
    await this.markLeaseDirty(sessionId, false);
    return {
      uploadedFiles: diff.changedFiles,
      deletedFiles: diff.deletedFiles
    };
  }

  async teardownSession(sessionId: string) {
    const lease = await this.metadata.getSessionRuntime(sessionId);
    if (!lease) {
      return;
    }

    await this.runtime.destroySandbox(lease.sandboxName);
    await cleanupSessionWorkspace(resolveSessionWorkspacePaths(this.config.scratchRoot, sessionId).sessionRoot);
    await this.metadata.deleteSessionRuntime(sessionId);
  }

  private buildLeaseRecord(request: SessionRuntimeRequest & { workspacePath: string }): SessionRuntimeLeaseRecord {
    const timestamp = new Date().toISOString();
    return {
      sessionId: request.sessionId,
      sandboxName: createSessionSandboxName(request.sessionId),
      workspacePath: request.workspacePath,
      image: request.image,
      cpuLimit: request.cpuLimit,
      memoryMb: request.memoryMb,
      networkMode: request.networkMode,
      allowedHostsKey: buildAllowedHostsKey(request.allowedHosts),
      hydrated: false,
      dirty: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp
    };
  }

  private isCompatible(lease: SessionRuntimeLeaseRecord, request: SessionRuntimeRequest) {
    return (
      lease.image === request.image &&
      lease.cpuLimit === request.cpuLimit &&
      lease.memoryMb === request.memoryMb &&
      lease.networkMode === request.networkMode &&
      lease.allowedHostsKey === buildAllowedHostsKey(request.allowedHosts)
    );
  }

  private toRuntimeSpec(lease: SessionRuntimeLeaseRecord): SessionRuntimeSpec {
    return {
      sandboxName: lease.sandboxName,
      image: lease.image,
      workspaceHostPath: lease.workspacePath,
      guestWorkspacePath: this.config.guestWorkspacePath,
      cpuLimit: lease.cpuLimit,
      memoryMb: lease.memoryMb,
      networkMode: lease.networkMode,
      allowedHosts: parseAllowedHostsKey(lease.allowedHostsKey)
    };
  }

  private async flushDirtyWorkspace(lease: SessionRuntimeLeaseRecord) {
    if (!(await pathExists(lease.workspacePath))) {
      await this.metadata.upsertSessionRuntime({
        ...lease,
        hydrated: false,
        dirty: false,
        updatedAt: new Date().toISOString()
      });
      return;
    }

    const manifest = await captureManifest(lease.workspacePath, [], { hashAllFiles: true });
    const diff = diffMetadataFiles(
      (await this.metadata.listFiles(lease.sessionId)).map((file) => ({
        path: file.path,
        size: file.size,
        checksum: file.checksum
      })),
      manifest
    );
    await this.persistDiff(lease.sessionId, lease.workspacePath, manifest, diff.changedFiles, diff.deletedFiles);
    await this.metadata.upsertSessionRuntime({
      ...lease,
      hydrated: true,
      dirty: false,
      updatedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    });
  }

  private async reconcileWorkspaceFromStorage(sessionId: string, workspacePath: string) {
    const metadataFiles = await this.metadata.listFiles(sessionId);
    const currentManifest = await captureManifest(workspacePath, [], { hashAllFiles: true });
    const metadataByPath = new Map(metadataFiles.map((file) => [file.path, file]));
    const changedFiles = metadataFiles
      .filter((file) => {
        const current = currentManifest.get(file.path);
        return current?.kind !== "file" || current.size !== file.size || current.hash !== file.checksum;
      })
      .map((file) => file.path);
    const deletedFiles = [...currentManifest.entries()]
      .filter(([path, entry]) => entry.kind === "file" && !metadataByPath.has(path))
      .map(([path]) => path)
      .sort();

    if (changedFiles.length > 0) {
      await this.sync.stageFiles(sessionId, changedFiles, workspacePath);
    }

    for (const deletedPath of deletedFiles) {
      await this.sync.deleteWorkspaceFile(workspacePath, deletedPath);
    }
  }

  private async persistDiff(
    sessionId: string,
    workspacePath: string,
    manifest: WorkspaceManifest,
    changedFiles: string[],
    deletedFiles: string[]
  ) {
    const uploadedFiles = await this.sync.persistFiles(workspacePath, sessionId, changedFiles);

    for (const relativePath of uploadedFiles) {
      const fileStats = await statWithin(workspacePath, relativePath);
      const checksum = manifest.get(relativePath)?.hash ?? (await sha256File(resolveWithin(workspacePath, relativePath)));
      await this.metadata.upsertFile(sessionId, relativePath, fileStats.size, null, checksum);
    }

    for (const relativePath of deletedFiles) {
      await this.storage.deleteFile(sessionId, relativePath);
      await this.metadata.deleteFile(sessionId, relativePath);
    }
  }
}

export function buildAllowedHostsKey(allowedHosts: string[]) {
  return [...new Set(allowedHosts.map((value) => value.trim()).filter(Boolean))].sort().join(",");
}

function parseAllowedHostsKey(value: string) {
  if (!value) {
    return [];
  }

  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}
