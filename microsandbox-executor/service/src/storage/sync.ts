import { dirname } from "node:path";
import { writeFile } from "node:fs/promises";
import { symlink } from "node:fs/promises";
import { posix } from "node:path";

import { ensureDir, normalizeRelativePath, pathExists, removeFileIfExists, resolveWithin } from "../util/fs.js";
import type { SessionStorage } from "./types.js";

export class WorkspaceSync {
  constructor(private readonly storage: SessionStorage) {}

  async stageFiles(sessionId: string, filePaths: string[], workspacePath: string) {
    const stagedFiles = await this.storage.stageFiles(sessionId, filePaths, workspacePath);
    await createWorkspaceAliases(stagedFiles, workspacePath);
    return stagedFiles;
  }

  async persistFiles(workspacePath: string, sessionId: string, relativePaths: string[]) {
    const persistedFiles = [...new Set(relativePaths.map((relativePath) => normalizeRelativePath(relativePath)))].sort();
    return this.storage.persistFiles(sessionId, workspacePath, persistedFiles);
  }

  async writeWorkspaceFile(workspacePath: string, relativePath: string, contents: Buffer) {
    const destinationPath = resolveWithin(workspacePath, relativePath);
    await ensureDir(dirname(destinationPath));
    await writeFile(destinationPath, contents);
  }

  async deleteWorkspaceFile(workspacePath: string, relativePath: string) {
    await removeFileIfExists(resolveWithin(workspacePath, relativePath));
  }
}

async function createWorkspaceAliases(filePaths: string[], workspacePath: string) {
  const normalizedPaths = [...new Set(filePaths.map((filePath) => normalizeRelativePath(filePath)))];
  const basenameCounts = new Map<string, number>();

  for (const filePath of normalizedPaths) {
    const basename = posix.basename(filePath);
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  for (const filePath of normalizedPaths) {
    const basename = posix.basename(filePath);

    if (basename === filePath || basenameCounts.get(basename) !== 1) {
      continue;
    }

    const aliasPath = resolveWithin(workspacePath, basename);

    if (await pathExists(aliasPath)) {
      continue;
    }

    await symlink(filePath, aliasPath);
  }
}
