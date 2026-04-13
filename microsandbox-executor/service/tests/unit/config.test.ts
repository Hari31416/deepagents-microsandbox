import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../../src/config.js";

test("loadConfig uses local session storage settings", () => {
  const config = loadConfig({
    SESSION_STORAGE_ROOT: "/tmp/sessions",
    SQLITE_DB_PATH: "/tmp/sessions/metadata.sqlite"
  });

  assert.equal(config.sessionStorageRoot, "/tmp/sessions");
  assert.equal(config.sqliteDbPath, "/tmp/sessions/metadata.sqlite");
  assert.equal(config.sessionTtlSeconds, 24 * 60 * 60);
  assert.equal(config.sessionCleanupIntervalSeconds, 10 * 60);
  assert.equal(config.maxUploadBytes, 20 * 1024 * 1024);
  assert.equal(config.maxFilesPerUpload, 10);
  assert.equal(config.runtimeImages.default, "python:3.12");
  assert.equal(config.runtimeImages["data-science"], "hari31416/sandbox-data-science:py312-v1");
  assert.equal(config.enableRestrictedExec, false);
  assert.deepEqual(config.blockedImports, ["subprocess", "socket", "multiprocessing", "resource", "pty"]);
});

test("loadConfig parses boolean env strings explicitly", () => {
  const config = loadConfig({
    ENABLE_RESTRICTED_EXEC: "false",
    SESSION_TTL_SECONDS: "3600",
    SESSION_CLEANUP_INTERVAL_SECONDS: "120"
  });

  assert.equal(config.enableRestrictedExec, false);
  assert.equal(config.sessionTtlSeconds, 3600);
  assert.equal(config.sessionCleanupIntervalSeconds, 120);
});
