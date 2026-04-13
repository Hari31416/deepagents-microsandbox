import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SqliteMetadataStore } from "../../src/metadata/sqlite_store.js";

test("MetadataStore creates, touches, and expires sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "metadata-store-"));
  const store = await SqliteMetadataStore.create(join(root, "metadata.sqlite"), 1);

  const session = store.createSession("sess_test");
  assert.equal(session.sessionId, "sess_test");
  assert.equal(store.getRequiredSession("sess_test").activeJobCount, 0);

  store.incrementActiveJobCount("sess_test");
  assert.equal(store.getRequiredSession("sess_test").activeJobCount, 1);

  store.decrementActiveJobCount("sess_test");
  assert.equal(store.getRequiredSession("sess_test").activeJobCount, 0);

  store.touchSession("sess_test");
  assert.equal(store.listExpiredSessionIds("9999-01-01T00:00:00.000Z").includes("sess_test"), true);
  store.close();
});

test("MetadataStore upserts files and tracks jobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "metadata-store-"));
  const store = await SqliteMetadataStore.create(join(root, "metadata.sqlite"), 60);

  store.createSession("sess_files");
  store.upsertFile("sess_files", "input.csv", 123, "text/csv");
  store.upsertFile("sess_files", "output.csv", 321, "text/csv");

  const files = store.listFiles("sess_files");
  assert.deepEqual(
    files.map((file) => file.path),
    ["input.csv", "output.csv"]
  );

  store.createJob("job_1", {
    sessionId: "sess_files",
    filePaths: ["input.csv"],
    code: "print('hello')",
    entrypoint: "main.py",
    pythonProfile: "default",
    networkMode: "none",
    allowedHosts: [],
    environment: {},
    restrictedExec: false,
    jobId: "job_1"
  });
  store.markJobRunning("job_1");
  store.completeJob("job_1", {
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 10,
    filesUploaded: ["output.csv"]
  });

  const job = store.getRequiredJob("job_1");
  assert.equal(job.status, "completed");
  assert.deepEqual(job.filesUploaded, ["output.csv"]);
  store.close();
});
