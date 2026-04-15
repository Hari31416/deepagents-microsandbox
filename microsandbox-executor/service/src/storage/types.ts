export interface StorageHealth {
  ok: boolean;
  details: string;
}

export interface DownloadHandle {
  stream: NodeJS.ReadableStream;
  size: number;
}

export interface SessionStorage {
  healthCheck(): Promise<StorageHealth>;
  ensureSessionRoot(sessionId: string): Promise<void>;
  saveUpload(sessionId: string, relativePath: string, contents: Buffer, contentType?: string | null): Promise<void>;
  deleteFile(sessionId: string, relativePath: string): Promise<void>;
  stageFiles(sessionId: string, filePaths: string[], workspacePath: string): Promise<string[]>;
  persistFiles(sessionId: string, workspacePath: string, relativePaths: string[]): Promise<string[]>;
  openDownload(sessionId: string, relativePath: string): Promise<DownloadHandle>;
  deleteSession(sessionId: string): Promise<void>;
  sessionExists(sessionId: string): Promise<boolean>;
}
