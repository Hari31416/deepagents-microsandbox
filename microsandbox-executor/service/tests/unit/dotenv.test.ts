import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadEnvFile } from "../../src/config.js";

test("loadEnvFile loads configuration from an explicit .env path", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "executor-dotenv-"));
  const envFile = join(tempDir, ".env");

  delete process.env.PORT;
  delete process.env.LOG_LEVEL;

  await writeFile(envFile, "PORT=4310\nLOG_LEVEL=debug\n", "utf8");

  const loadedPaths = loadEnvFile(envFile);

  assert.ok(Array.isArray(loadedPaths));
  assert.equal(loadedPaths.at(-1), envFile);
  assert.equal(process.env.PORT, "4310");
  assert.equal(process.env.LOG_LEVEL, "debug");
});
