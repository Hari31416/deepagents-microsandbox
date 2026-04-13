import type { ExecutionRequest, JobRecord } from "../jobs/models.js";

export interface SessionRecord {
  sessionId: string;
  createdAt: string;
  lastAccessedAt: string;
  expiresAt: string;
  activeJobCount: number;
  deleting: boolean;
}

export interface SessionFileRecord {
  sessionId: string;
  path: string;
  size: number;
  contentType: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MetadataHealth {
  ok: boolean;
  details: string;
}

export interface MetadataStore {
  close(): Promise<void> | void;
  healthCheck(): Promise<MetadataHealth> | MetadataHealth;
  createSession(sessionId: string): Promise<SessionRecord> | SessionRecord;
  getSession(sessionId: string): Promise<SessionRecord | null> | SessionRecord | null;
  getRequiredSession(sessionId: string): Promise<SessionRecord> | SessionRecord;
  touchSession(sessionId: string): Promise<void> | void;
  incrementActiveJobCount(sessionId: string): Promise<void> | void;
  decrementActiveJobCount(sessionId: string): Promise<void> | void;
  markSessionDeleting(sessionId: string): Promise<boolean> | boolean;
  clearSessionDeleting(sessionId: string): Promise<void> | void;
  deleteSession(sessionId: string): Promise<void> | void;
  upsertFile(sessionId: string, path: string, size: number, contentType: string | null): Promise<void> | void;
  listFiles(sessionId: string): Promise<SessionFileRecord[]> | SessionFileRecord[];
  getFile(sessionId: string, path: string): Promise<SessionFileRecord | null> | SessionFileRecord | null;
  createJob(jobId: string, request: ExecutionRequest): Promise<JobRecord> | JobRecord;
  markJobRunning(jobId: string): Promise<JobRecord> | JobRecord;
  completeJob(
    jobId: string,
    result: Pick<JobRecord, "exitCode" | "stdout" | "stderr" | "durationMs" | "filesUploaded">
  ): Promise<JobRecord> | JobRecord;
  failJob(
    jobId: string,
    error: unknown,
    result?: Partial<Pick<JobRecord, "exitCode" | "stdout" | "stderr" | "durationMs" | "filesUploaded">>
  ): Promise<JobRecord> | JobRecord;
  getJob(jobId: string): Promise<JobRecord | null> | JobRecord | null;
  getRequiredJob(jobId: string): Promise<JobRecord> | JobRecord;
  listExpiredSessionIds(referenceIso?: string): Promise<string[]> | string[];
}
