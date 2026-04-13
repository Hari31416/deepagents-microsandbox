import type { ExecuteRequest, JobRecord } from "./models.js";

export class InMemoryJobStore {
  private readonly jobs = new Map<string, JobRecord>();

  create(jobId: string, request: ExecuteRequest): JobRecord {
    if (this.jobs.has(jobId)) {
      throw new Error(`Job already exists: ${jobId}`);
    }

    const record: JobRecord = {
      jobId,
      sessionId: request.sessionId,
      status: "queued",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: null,
      filesUploaded: [],
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      request
    };

    this.jobs.set(jobId, record);
    return record;
  }

  markRunning(jobId: string) {
    const current = this.getRequired(jobId);
    const updated: JobRecord = {
      ...current,
      status: "running",
      startedAt: new Date().toISOString()
    };

    this.jobs.set(jobId, updated);
    return updated;
  }

  complete(jobId: string, result: Pick<JobRecord, "exitCode" | "stdout" | "stderr" | "durationMs" | "filesUploaded">) {
    const current = this.getRequired(jobId);
    const updated: JobRecord = {
      ...current,
      status: "completed",
      completedAt: new Date().toISOString(),
      ...result
    };

    this.jobs.set(jobId, updated);
    return updated;
  }

  fail(jobId: string, error: unknown, result?: Partial<Pick<JobRecord, "exitCode" | "stdout" | "stderr" | "durationMs" | "filesUploaded">>) {
    const current = this.getRequired(jobId);
    const updated: JobRecord = {
      ...current,
      status: "failed",
      exitCode: result?.exitCode ?? null,
      stdout: result?.stdout ?? current.stdout,
      stderr: result?.stderr ?? formatError(error),
      durationMs: result?.durationMs ?? current.durationMs,
      filesUploaded: result?.filesUploaded ?? current.filesUploaded,
      completedAt: new Date().toISOString()
    };

    this.jobs.set(jobId, updated);
    return updated;
  }

  get(jobId: string) {
    return this.jobs.get(jobId) ?? null;
  }

  private getRequired(jobId: string) {
    const record = this.jobs.get(jobId);

    if (!record) {
      throw new Error(`Unknown job: ${jobId}`);
    }

    return record;
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown execution error";
}
