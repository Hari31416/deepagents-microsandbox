import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { JobExecutor } from "../../src/jobs/executor.js";
import { SqliteMetadataStore } from "../../src/metadata/sqlite_store.js";
import type {
  RuntimeExecInput,
  RuntimeHealth,
  RuntimeJobResult,
  RuntimeLeaseHandle,
  SandboxRuntime,
  SessionRuntimeSpec
} from "../../src/runtime/types.js";
import { SessionCleanupService } from "../../src/sessions/cleanup.js";
import { SessionLockManager } from "../../src/sessions/locks.js";
import { SessionRuntimeManager } from "../../src/sessions/runtime_manager.js";
import { LocalSessionStorage } from "../../src/storage/local.js";
import { WorkspaceSync } from "../../src/storage/sync.js";

class FakeRuntime implements SandboxRuntime {
  private readonly sandboxes = new Map<string, SessionRuntimeSpec>();

  async ensureSandbox(input: SessionRuntimeSpec): Promise<RuntimeLeaseHandle> {
    this.sandboxes.set(input.sandboxName, input);
    return { sandboxName: input.sandboxName };
  }

  async execInSandbox(input: RuntimeExecInput): Promise<RuntimeJobResult> {
    const sandbox = this.sandboxes.get(input.sandboxName);
    if (!sandbox) {
      throw new Error(`Sandbox not ready: ${input.sandboxName}`);
    }

    if (input.command === "bash") {
      const scriptPath = join(sandbox.workspaceHostPath, input.args[0] ?? "main.sh");
      const scriptContents = await readFile(scriptPath, "utf8");
      await writeFile(join(sandbox.workspaceHostPath, "bash-output.txt"), `ran:${scriptContents}`, "utf8");
      return {
        exitCode: 0,
        stdout: "bash ok\n",
        stderr: "",
        durationMs: 5
      };
    }

    const inputPath = join(sandbox.workspaceHostPath, "input.txt");
    const outputPath = join(sandbox.workspaceHostPath, "output.txt");
    const contents = await readFile(inputPath, "utf8");
    await writeFile(outputPath, contents.toUpperCase(), "utf8");
    return {
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      durationMs: 5
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

test("session routes support upload, execute, delete-file, listing, download, and delete-session", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-routes-"));
  const config = loadConfig({
    EXECUTOR_DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
    SCRATCH_ROOT: join(root, "scratch")
  });
  const runtime = new FakeRuntime();
  const storage = new LocalSessionStorage(join(root, "sessions"));
  const metadata = await SqliteMetadataStore.create(join(root, "metadata.sqlite"), config.sessionTtlSeconds);
  const locks = new SessionLockManager();
  const sync = new WorkspaceSync(storage);
  const runtimeManager = new SessionRuntimeManager(config, runtime, sync, storage, metadata);
  const cleanup = new SessionCleanupService(config, storage, metadata, locks, runtimeManager);
  const executor = new JobExecutor(config, runtime, metadata, locks, runtimeManager);
  const app = await buildApp({
    config,
    runtime,
    storage,
    metadata,
    locks,
    cleanup,
    runtimeManager,
    sync,
    executor
  });

  const createSession = await app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: {
      "content-type": "application/json"
    },
    payload: {}
  });
  assert.equal(createSession.statusCode, 201);
  const session = createSession.json() as { session_id: string };

  const boundary = "----codex-session-test";
  const multipartBody = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="files"; filename="input.txt"',
    "Content-Type: text/plain",
    "",
    "hello world",
    `--${boundary}--`,
    ""
  ].join("\r\n");
  const upload = await app.inject({
    method: "POST",
    url: `/v1/sessions/${session.session_id}/files`,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`
    },
    payload: multipartBody
  });
  assert.equal(upload.statusCode, 201);
  assert.deepEqual((upload.json() as { file_paths: string[] }).file_paths, ["input.txt"]);

  const execute = await app.inject({
    method: "POST",
    url: "/v1/execute",
    headers: {
      "content-type": "application/json"
    },
    payload: {
      session_id: session.session_id,
      code: "print('hello')"
    }
  });
  assert.equal(execute.statusCode, 200);
  assert.deepEqual((execute.json() as { files_uploaded: string[] }).files_uploaded.sort(), ["main.py", "output.txt"]);

  const deleteFile = await app.inject({
    method: "DELETE",
    url: `/v1/sessions/${session.session_id}/files/main.py`
  });
  assert.equal(deleteFile.statusCode, 204);

  const list = await app.inject({
    method: "GET",
    url: `/v1/sessions/${session.session_id}/files`
  });
  assert.equal(list.statusCode, 200);
  const listedFiles = (list.json() as { files: Array<{ path: string }> }).files.map((file) => file.path);
  assert.deepEqual(listedFiles, ["input.txt", "output.txt"]);

  const download = await app.inject({
    method: "GET",
    url: `/v1/sessions/${session.session_id}/files/output.txt`
  });
  assert.equal(download.statusCode, 200);
  assert.equal(download.body, "HELLO WORLD");

  const bashExecute = await app.inject({
    method: "POST",
    url: "/v1/execute/bash",
    headers: {
      "content-type": "application/json"
    },
    payload: {
      session_id: session.session_id,
      script: "echo bash > bash-output.txt"
    }
  });
  assert.equal(bashExecute.statusCode, 200);
  assert.deepEqual((bashExecute.json() as { files_uploaded: string[] }).files_uploaded.sort(), ["bash-output.txt", "main.sh"]);

  const remove = await app.inject({
    method: "DELETE",
    url: `/v1/sessions/${session.session_id}`
  });
  assert.equal(remove.statusCode, 204);

  await app.close();
});
