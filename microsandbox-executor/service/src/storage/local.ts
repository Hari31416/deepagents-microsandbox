import { access, createReadStream } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

import { ensureDir, pathExists, removeDirIfExists, resolveWithin, statWithin } from "../util/fs.js";
import type { DownloadHandle, SessionStorage, StorageHealth } from "./types.js";

const accessAsync = promisify(access);

export class LocalSessionStorage implements SessionStorage {
  constructor(private readonly rootPath: string) {}

  async healthCheck(): Promise<StorageHealth> {
    try {
      await ensureDir(this.rootPath);
      await accessAsync(this.rootPath);

      return {
        ok: true,
        details: "local session storage ready"
      };
    } catch (error) {
      return {
        ok: false,
        details: error instanceof Error ? error.message : "local session storage unavailable"
      };
    }
  }

  async ensureSessionRoot(sessionId: string) {
    await ensureDir(this.resolveSessionRoot(sessionId));
  }

  async saveUpload(sessionId: string, relativePath: string, contents: Buffer) {
    const destinationPath = resolveWithin(this.resolveSessionRoot(sessionId), relativePath);
    await ensureDir(dirname(destinationPath));
    await writeFile(destinationPath, contents);
  }

  async stageFiles(sessionId: string, filePaths: string[], workspacePath: string) {
    const staged: string[] = [];

    for (const filePath of filePaths) {
      const sourcePath = resolveWithin(this.resolveSessionRoot(sessionId), filePath);
      const destinationPath = resolveWithin(workspacePath, filePath);

      await ensureDir(dirname(destinationPath));
      await copyFile(sourcePath, destinationPath);
      staged.push(filePath);
    }

    staged.sort();
    return staged;
  }

  async persistFiles(sessionId: string, workspacePath: string, relativePaths: string[]) {
    const persisted: string[] = [];

    for (const relativePath of relativePaths) {
      const sourcePath = resolveWithin(workspacePath, relativePath);
      const destinationPath = resolveWithin(this.resolveSessionRoot(sessionId), relativePath);

      await ensureDir(dirname(destinationPath));
      await copyFile(sourcePath, destinationPath);
      persisted.push(relativePath);
    }

    persisted.sort();
    return persisted;
  }

  async openDownload(sessionId: string, relativePath: string): Promise<DownloadHandle> {
    const stats = await statWithin(this.resolveSessionRoot(sessionId), relativePath);

    return {
      stream: createReadStream(resolveWithin(this.resolveSessionRoot(sessionId), relativePath)),
      size: stats.size
    };
  }

  async deleteSession(sessionId: string) {
    await removeDirIfExists(this.resolveSessionRoot(sessionId));
  }

  async sessionExists(sessionId: string) {
    return pathExists(this.resolveSessionRoot(sessionId));
  }

  resolveSessionRoot(sessionId: string) {
    return resolveWithin(this.rootPath, sessionId);
  }
}
