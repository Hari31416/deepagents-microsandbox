import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";

import { WorkspaceSync } from "../../src/storage/sync.js";
import { LocalSessionStorage } from "../../src/storage/local.js";

class FakeStorage {
  persistedFiles: string[] = [];

  async stageFiles(_sessionId: string, filePaths: string[], workspacePath: string): Promise<string[]> {
    for (const filePath of filePaths) {
      const absolutePath = join(workspacePath, filePath);
      await mkdir(join(absolutePath, ".."), { recursive: true });
      await writeFile(absolutePath, `contents:${filePath}`, "utf8");
    }

    return filePaths;
  }

  async persistFiles(_sessionId: string, _workspacePath: string, relativePaths: string[]): Promise<string[]> {
    this.persistedFiles = relativePaths;
    return relativePaths;
  }
}

test("WorkspaceSync stages unique top-level aliases for nested files", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "workspace-sync-"));
  const sync = new WorkspaceSync(new FakeStorage() as unknown as LocalSessionStorage);

  await sync.stageFiles("sess-1", ["demo/sess-1/inputs/titanic.csv"], workspacePath);

  const aliasStats = await lstat(join(workspacePath, "titanic.csv"));
  assert.equal(aliasStats.isSymbolicLink(), true);
  assert.equal(await readlink(join(workspacePath, "titanic.csv")), "demo/sess-1/inputs/titanic.csv");
  assert.equal(await readFile(join(workspacePath, "titanic.csv"), "utf8"), "contents:demo/sess-1/inputs/titanic.csv");
});

test("WorkspaceSync skips aliases when nested files share the same basename", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "workspace-sync-"));
  const sync = new WorkspaceSync(new FakeStorage() as unknown as LocalSessionStorage);

  await sync.stageFiles(
    "sess-1",
    ["demo/sess-1/inputs/titanic.csv", "demo/sess-1/archive/titanic.csv"],
    workspacePath
  );

  await assert.rejects(() => lstat(join(workspacePath, "titanic.csv")), { code: "ENOENT" });
});

test("WorkspaceSync persists normalized changed files", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "workspace-sync-"));
  const storage = new FakeStorage();
  const sync = new WorkspaceSync(storage as unknown as LocalSessionStorage);

  await sync.persistFiles(workspacePath, "demo-sess-1", ["titanic_cleaned.csv", "reports/daily.csv"]);

  assert.deepEqual(storage.persistedFiles, ["reports/daily.csv", "titanic_cleaned.csv"]);
});

test("WorkspaceSync deduplicates persisted file paths", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "workspace-sync-"));
  const storage = new FakeStorage();
  const sync = new WorkspaceSync(storage as unknown as LocalSessionStorage);

  await sync.persistFiles(workspacePath, "demo-sess-1", ["result.txt", "result.txt"]);

  assert.deepEqual(storage.persistedFiles, ["result.txt"]);
});
