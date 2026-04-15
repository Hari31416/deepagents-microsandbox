import { dirname, join } from "node:path";

import { Client } from "minio";

import { ensureDir, resolveWithin } from "../util/fs.js";
import type { DownloadHandle, SessionStorage, StorageHealth } from "./types.js";

export class MinioSessionStorage implements SessionStorage {
  constructor(
    private readonly client: Client,
    private readonly bucketName: string,
    private readonly prefix: string
  ) {}

  async healthCheck(): Promise<StorageHealth> {
    try {
      const exists = await this.client.bucketExists(this.bucketName);
      return {
        ok: exists,
        details: exists ? "minio session storage ready" : `bucket ${this.bucketName} does not exist`
      };
    } catch (error) {
      return {
        ok: false,
        details: error instanceof Error ? error.message : "minio session storage unavailable"
      };
    }
  }

  async ensureSessionRoot(_sessionId: string) {
    // MinIO is object-backed, so there is no physical directory to create.
  }

  async saveUpload(sessionId: string, relativePath: string, contents: Buffer, contentType?: string | null) {
    await this.client.putObject(this.bucketName, this.objectKey(sessionId, relativePath), contents, contents.length, {
      "Content-Type": contentType ?? "application/octet-stream"
    });
  }

  async deleteFile(sessionId: string, relativePath: string) {
    await this.client.removeObject(this.bucketName, this.objectKey(sessionId, relativePath));
  }

  async stageFiles(sessionId: string, filePaths: string[], workspacePath: string) {
    const staged: string[] = [];

    for (const filePath of filePaths) {
      const destinationPath = resolveWithin(workspacePath, filePath);
      await ensureDir(dirname(destinationPath));
      await this.client.fGetObject(this.bucketName, this.objectKey(sessionId, filePath), destinationPath);
      staged.push(filePath);
    }

    staged.sort();
    return staged;
  }

  async persistFiles(sessionId: string, workspacePath: string, relativePaths: string[]) {
    const persisted: string[] = [];

    for (const relativePath of relativePaths) {
      const sourcePath = resolveWithin(workspacePath, relativePath);
      await this.client.fPutObject(this.bucketName, this.objectKey(sessionId, relativePath), sourcePath);
      persisted.push(relativePath);
    }

    persisted.sort();
    return persisted;
  }

  async openDownload(sessionId: string, relativePath: string): Promise<DownloadHandle> {
    const objectKey = this.objectKey(sessionId, relativePath);
    const objectStat = await this.client.statObject(this.bucketName, objectKey);
    const stream = await this.client.getObject(this.bucketName, objectKey);

    return {
      stream,
      size: objectStat.size
    };
  }

  async deleteSession(sessionId: string) {
    const prefix = `${this.sessionPrefix(sessionId)}/`;
    const objectNames: string[] = [];
    const stream = this.client.listObjectsV2(this.bucketName, prefix, true);

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (objectInfo) => {
        if (objectInfo.name) {
          objectNames.push(objectInfo.name);
        }
      });
      stream.on("end", () => resolve());
      stream.on("error", (error) => reject(error));
    });

    if (objectNames.length > 0) {
      await this.client.removeObjects(this.bucketName, objectNames);
    }
  }

  async sessionExists(sessionId: string) {
    const prefix = `${this.sessionPrefix(sessionId)}/`;
    const stream = this.client.listObjectsV2(this.bucketName, prefix, true, "");

    return new Promise<boolean>((resolve, reject) => {
      let seen = false;
      stream.on("data", (objectInfo) => {
        if (objectInfo.name) {
          seen = true;
          resolve(true);
          stream.destroy();
        }
      });
      stream.on("end", () => {
        if (!seen) {
          resolve(false);
        }
      });
      stream.on("error", (error) => reject(error));
    });
  }

  private objectKey(sessionId: string, relativePath: string) {
    return `${this.sessionPrefix(sessionId)}/${relativePath}`;
  }

  private sessionPrefix(sessionId: string) {
    return join(this.prefix, sessionId).replaceAll("\\", "/");
  }
}
