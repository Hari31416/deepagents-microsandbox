import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";

import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { JobExecutor } from "../../src/jobs/executor.js";
import { SqliteMetadataStore } from "../../src/metadata/sqlite_store.js";
import { SessionCleanupService } from "../../src/sessions/cleanup.js";
import { SessionLockManager } from "../../src/sessions/locks.js";
import { LocalSessionStorage } from "../../src/storage/local.js";
import { WorkspaceSync } from "../../src/storage/sync.js";
import type { RuntimeHealth, RuntimeJobInput, RuntimeJobResult, SandboxRuntime } from "../../src/runtime/types.js";

class FakeRuntime implements SandboxRuntime {
  async executeJob(input: RuntimeJobInput): Promise<RuntimeJobResult> {
    if (input.command === "bash") {
      const scriptPath = join(input.workspaceHostPath, input.args[0] ?? "main.sh");
      const scriptContents = await readFile(scriptPath, "utf8");
      await writeFile(join(input.workspaceHostPath, "bash-output.txt"), `ran:${scriptContents}`, "utf8");

      return {
        exitCode: 0,
        stdout: "bash ok\n",
        stderr: "",
        durationMs: 5
      };
    }

    const inputPath = join(input.workspaceHostPath, "input.txt");
    const outputPath = join(input.workspaceHostPath, "output.txt");
    const contents = await readFile(inputPath, "utf8");
    await writeFile(outputPath, contents.toUpperCase(), "utf8");

    return {
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      durationMs: 5
    };
  }

  async healthCheck(): Promise<RuntimeHealth> {
    return {
      ok: true,
      runtime: "fake",
      details: "ok"
    };
  }
}

test("session routes support upload, full-session execute, listing, download, and delete", async () => {
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
  const cleanup = new SessionCleanupService(config, storage, metadata, locks);
  const executor = new JobExecutor(config, runtime, sync, metadata, locks);
  const app = await buildApp({
    config,
    runtime,
    storage,
    metadata,
    locks,
    cleanup,
    sync,
    executor
  });

  const docs = await app.inject({
    method: "GET",
    url: "/docs"
  });
  assert.equal(docs.statusCode, 200);
  assert.match(docs.headers["content-type"] ?? "", /text\/html/);

  const openapi = await app.inject({
    method: "GET",
    url: "/docs/json"
  });
  assert.equal(openapi.statusCode, 200);
  assert.match(openapi.headers["content-type"] ?? "", /application\/json/);
  assert.equal((openapi.json() as { openapi: string }).openapi, "3.0.3");

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

  const nestedBoundary = "----codex-session-nested-test";
  const nestedMultipartBody = [
    `--${nestedBoundary}`,
    'Content-Disposition: form-data; name="files"; filename="nested/fixtures/input-2.txt"',
    "Content-Type: text/plain",
    "",
    "nested hello",
    `--${nestedBoundary}--`,
    ""
  ].join("\r\n");
  const nestedUpload = await app.inject({
    method: "POST",
    url: `/v1/sessions/${session.session_id}/files`,
    headers: {
      "content-type": `multipart/form-data; boundary=${nestedBoundary}`
    },
    payload: nestedMultipartBody
  });
  assert.equal(nestedUpload.statusCode, 201);
  assert.deepEqual((nestedUpload.json() as { file_paths: string[] }).file_paths, ["nested/fixtures/input-2.txt"]);

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
  const execution = execute.json() as { files_uploaded: string[] };
  assert.deepEqual(execution.files_uploaded.sort(), ["main.py", "output.txt"]);

  const list = await app.inject({
    method: "GET",
    url: `/v1/sessions/${session.session_id}/files`
  });
  assert.equal(list.statusCode, 200);
  const listedFiles = (list.json() as { files: Array<{ path: string }> }).files.map((file) => file.path);
  assert.deepEqual(listedFiles, ["input.txt", "main.py", "nested/fixtures/input-2.txt", "output.txt"]);

  const download = await app.inject({
    method: "GET",
    url: `/v1/sessions/${session.session_id}/files/output.txt`
  });
  assert.equal(download.statusCode, 200);
  assert.equal(download.body, "HELLO WORLD");

  const nestedDownload = await app.inject({
    method: "GET",
    url: `/v1/sessions/${session.session_id}/files/nested/fixtures/input-2.txt`
  });
  assert.equal(nestedDownload.statusCode, 200);
  assert.equal(nestedDownload.body, "nested hello");

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
  const bashExecution = bashExecute.json() as { files_uploaded: string[] };
  assert.deepEqual(bashExecution.files_uploaded.sort(), ["bash-output.txt", "main.sh"]);

  const bashDownload = await app.inject({
    method: "GET",
    url: `/v1/sessions/${session.session_id}/files/bash-output.txt`
  });
  assert.equal(bashDownload.statusCode, 200);
  assert.equal(bashDownload.body, "ran:echo bash > bash-output.txt");

  const remove = await app.inject({
    method: "DELETE",
    url: `/v1/sessions/${session.session_id}`
  });
  assert.equal(remove.statusCode, 204);

  await app.close();
});
