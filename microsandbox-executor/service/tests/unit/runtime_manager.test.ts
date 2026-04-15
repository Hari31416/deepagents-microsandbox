import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../../src/config.js";
import { SqliteMetadataStore } from "../../src/metadata/sqlite_store.js";
import type {
  RuntimeExecInput,
  RuntimeHealth,
  RuntimeJobResult,
  RuntimeLeaseHandle,
  SandboxRuntime,
  SessionRuntimeSpec
} from "../../src/runtime/types.js";
import { SessionRuntimeManager } from "../../src/sessions/runtime_manager.js";
import { LocalSessionStorage } from "../../src/storage/local.js";
import { WorkspaceSync } from "../../src/storage/sync.js";

class FakeRuntime implements SandboxRuntime {
  private readonly sandboxes = new Map<string, SessionRuntimeSpec>();

  async ensureSandbox(input: SessionRuntimeSpec): Promise<RuntimeLeaseHandle> {
    this.sandboxes.set(input.sandboxName, input);
    return { sandboxName: input.sandboxName };
  }

  async execInSandbox(_input: RuntimeExecInput): Promise<RuntimeJobResult> {
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1
    };
  }

  async destroySandbox(sandboxName: string) {
    this.sandboxes.delete(sandboxName);
  }

  async destroyAllSandboxes() {
    this.sandboxes.clear();
  }

  async listSandboxes() {
    return [...this.sandboxes.keys()].sort();
  }

  async healthCheck(): Promise<RuntimeHealth> {
    return {
      ok: true,
      runtime: "fake",
      details: "ok"
    };
  }
}

test("SessionRuntimeManager reaps stale sandboxes and flushes dirty workspaces after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-manager-"));
  const config = loadConfig({
    EXECUTOR_DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
    SCRATCH_ROOT: join(root, "scratch")
  });
  const runtime = new FakeRuntime();
  const storage = new LocalSessionStorage(join(root, "sessions"));
  const metadata = await SqliteMetadataStore.create(join(root, "metadata.sqlite"), config.sessionTtlSeconds);
  const sync = new WorkspaceSync(storage);
  const manager = new SessionRuntimeManager(config, runtime, sync, storage, metadata);

  metadata.createSession("sess_restart");
  await storage.ensureSessionRoot("sess_restart");
  await manager.ensureLease({
    sessionId: "sess_restart",
    image: config.runtimeImages.default,
    cpuLimit: config.defaultCpuLimit,
    memoryMb: config.defaultMemoryMb,
    networkMode: "none",
    allowedHosts: []
  });

  const lease = metadata.getSessionRuntime("sess_restart");
  assert.ok(lease);
  await writeFile(join(lease.workspacePath, "dirty.txt"), "persist me", "utf8");
  await manager.markLeaseDirty("sess_restart", true);

  const restartedManager = new SessionRuntimeManager(config, runtime, sync, storage, metadata);
  await restartedManager.reconcileStartup();
  assert.deepEqual(await runtime.listSandboxes(), []);

  await restartedManager.ensureLease({
    sessionId: "sess_restart",
    image: config.runtimeImages.default,
    cpuLimit: config.defaultCpuLimit,
    memoryMb: config.defaultMemoryMb,
    networkMode: "none",
    allowedHosts: []
  });

  const file = await storage.openDownload("sess_restart", "dirty.txt");
  assert.equal(await streamToString(file.stream), "persist me");
  assert.equal(metadata.getFile("sess_restart", "dirty.txt")?.path, "dirty.txt");
  metadata.close();
});

async function streamToString(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
