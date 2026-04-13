import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureManifest, diffManifests } from "../../src/jobs/manifests.js";

test("diffManifests reports new and changed files but ignores internal paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "executor-manifest-"));

  await writeFile(join(root, "main.py"), "print('before')\n", "utf8");
  const before = await captureManifest(root);

  await writeFile(join(root, "main.py"), "print('after')\n", "utf8");
  await writeFile(join(root, "notes.txt"), "hello\n", "utf8");
  await mkdir(join(root, ".sandbox-executor"), { recursive: true });
  await writeFile(join(root, ".sandbox-executor", "runner.py"), "ignored\n", "utf8");

  const after = await captureManifest(root, [".sandbox-executor"]);
  const diff = diffManifests(before, after);

  assert.deepEqual(diff.changedFiles, ["main.py", "notes.txt"]);
});
