import { Pool } from "pg";

import type { ExecutionRequest, JobRecord } from "../jobs/models.js";
import type { MetadataHealth, MetadataStore, SessionFileRecord, SessionRecord } from "./types.js";

function nowIso() {
  return new Date().toISOString();
}

function expiresAtIso(ttlSeconds: number) {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

export class PostgresMetadataStore implements MetadataStore {
  constructor(
    private readonly pool: Pool,
    private readonly sessionTtlSeconds: number
  ) {}

  static async create(connectionString: string, sessionTtlSeconds: number) {
    const pool = new Pool({ connectionString });
    const store = new PostgresMetadataStore(pool, sessionTtlSeconds);
    await store.initialize();
    return store;
  }

  async close() {
    await this.pool.end();
  }

  async healthCheck(): Promise<MetadataHealth> {
    try {
      await this.pool.query("SELECT 1");
      return {
        ok: true,
        details: "postgres metadata store ready"
      };
    } catch (error) {
      return {
        ok: false,
        details: error instanceof Error ? error.message : "postgres metadata store unavailable"
      };
    }
  }

  async createSession(sessionId: string) {
    const createdAt = nowIso();
    const expiresAt = expiresAtIso(this.sessionTtlSeconds);
    await this.pool.query(
      `INSERT INTO sessions (
        session_id,
        created_at,
        last_accessed_at,
        expires_at,
        active_job_count,
        deleting
      ) VALUES ($1, $2, $2, $3, 0, false)`,
      [sessionId, createdAt, expiresAt]
    );
    return this.getRequiredSession(sessionId);
  }

  async getSession(sessionId: string) {
    const result = await this.pool.query(
      `SELECT session_id, created_at, last_accessed_at, expires_at, active_job_count, deleting
       FROM sessions
       WHERE session_id = $1`,
      [sessionId]
    );
    return result.rowCount ? mapSession(result.rows[0] as Record<string, unknown>) : null;
  }

  async getRequiredSession(sessionId: string) {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  async touchSession(sessionId: string) {
    const touchedAt = nowIso();
    const result = await this.pool.query(
      `UPDATE sessions
       SET last_accessed_at = $1, expires_at = $2
       WHERE session_id = $3`,
      [touchedAt, expiresAtIso(this.sessionTtlSeconds), sessionId]
    );
    if (result.rowCount === 0) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
  }

  async incrementActiveJobCount(sessionId: string) {
    await this.touchSession(sessionId);
    await this.pool.query(
      `UPDATE sessions
       SET active_job_count = active_job_count + 1
       WHERE session_id = $1`,
      [sessionId]
    );
  }

  async decrementActiveJobCount(sessionId: string) {
    await this.touchSession(sessionId);
    await this.pool.query(
      `UPDATE sessions
       SET active_job_count = CASE WHEN active_job_count > 0 THEN active_job_count - 1 ELSE 0 END
       WHERE session_id = $1`,
      [sessionId]
    );
  }

  async markSessionDeleting(sessionId: string) {
    const result = await this.pool.query(
      `UPDATE sessions
       SET deleting = true
       WHERE session_id = $1
         AND active_job_count = 0
         AND deleting = false`,
      [sessionId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async clearSessionDeleting(sessionId: string) {
    await this.pool.query(`UPDATE sessions SET deleting = false WHERE session_id = $1`, [sessionId]);
  }

  async deleteSession(sessionId: string) {
    await this.pool.query(`DELETE FROM sessions WHERE session_id = $1`, [sessionId]);
  }

  async upsertFile(sessionId: string, path: string, size: number, contentType: string | null) {
    const timestamp = nowIso();
    await this.pool.query(
      `INSERT INTO session_files (
        session_id, path, size, content_type, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $5)
      ON CONFLICT (session_id, path) DO UPDATE
      SET size = EXCLUDED.size,
          content_type = EXCLUDED.content_type,
          updated_at = EXCLUDED.updated_at`,
      [sessionId, path, size, contentType, timestamp]
    );
  }

  async listFiles(sessionId: string): Promise<SessionFileRecord[]> {
    const result = await this.pool.query(
      `SELECT session_id, path, size, content_type, created_at, updated_at
       FROM session_files
       WHERE session_id = $1
       ORDER BY path ASC`,
      [sessionId]
    );
    return result.rows.map((row: Record<string, unknown>) => mapSessionFile(row));
  }

  async getFile(sessionId: string, path: string) {
    const result = await this.pool.query(
      `SELECT session_id, path, size, content_type, created_at, updated_at
       FROM session_files
       WHERE session_id = $1 AND path = $2`,
      [sessionId, path]
    );
    return result.rowCount ? mapSessionFile(result.rows[0] as Record<string, unknown>) : null;
  }

  async createJob(jobId: string, request: ExecutionRequest) {
    if (await this.getJob(jobId)) {
      throw new Error(`Job already exists: ${jobId}`);
    }
    const createdAt = nowIso();
    await this.pool.query(
      `INSERT INTO jobs (
        job_id, session_id, status, exit_code, stdout, stderr, duration_ms,
        files_uploaded_json, created_at, started_at, completed_at, request_json
      ) VALUES ($1, $2, 'queued', NULL, '', '', NULL, '[]', $3, NULL, NULL, $4)`,
      [jobId, request.sessionId, createdAt, JSON.stringify(request)]
    );
    return this.getRequiredJob(jobId);
  }

  async markJobRunning(jobId: string) {
    const startedAt = nowIso();
    const result = await this.pool.query(
      `UPDATE jobs SET status = 'running', started_at = $1 WHERE job_id = $2`,
      [startedAt, jobId]
    );
    if (result.rowCount === 0) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    return this.getRequiredJob(jobId);
  }

  async completeJob(jobId: string, result: Pick<JobRecord, "exitCode" | "stdout" | "stderr" | "durationMs" | "filesUploaded">) {
    const completedAt = nowIso();
    const update = await this.pool.query(
      `UPDATE jobs
       SET status = 'completed',
           exit_code = $1,
           stdout = $2,
           stderr = $3,
           duration_ms = $4,
           files_uploaded_json = $5,
           completed_at = $6
       WHERE job_id = $7`,
      [result.exitCode, result.stdout, result.stderr, result.durationMs, JSON.stringify(result.filesUploaded), completedAt, jobId]
    );
    if (update.rowCount === 0) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    return this.getRequiredJob(jobId);
  }

  async failJob(jobId: string, error: unknown, result?: Partial<Pick<JobRecord, "exitCode" | "stdout" | "stderr" | "durationMs" | "filesUploaded">>) {
    const current = await this.getRequiredJob(jobId);
    const completedAt = nowIso();
    const update = await this.pool.query(
      `UPDATE jobs
       SET status = 'failed',
           exit_code = $1,
           stdout = $2,
           stderr = $3,
           duration_ms = $4,
           files_uploaded_json = $5,
           completed_at = $6
       WHERE job_id = $7`,
      [
        result?.exitCode ?? current.exitCode,
        result?.stdout ?? current.stdout,
        result?.stderr ?? formatError(error),
        result?.durationMs ?? current.durationMs,
        JSON.stringify(result?.filesUploaded ?? current.filesUploaded),
        completedAt,
        jobId
      ]
    );
    if (update.rowCount === 0) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    return this.getRequiredJob(jobId);
  }

  async getJob(jobId: string) {
    const result = await this.pool.query(
      `SELECT
        job_id, session_id, status, exit_code, stdout, stderr, duration_ms,
        files_uploaded_json, created_at, started_at, completed_at, request_json
       FROM jobs WHERE job_id = $1`,
      [jobId]
    );
    return result.rowCount ? mapJob(result.rows[0] as Record<string, unknown>) : null;
  }

  async getRequiredJob(jobId: string) {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    return job;
  }

  async listExpiredSessionIds(referenceIso = nowIso()) {
    const result = await this.pool.query(
      `SELECT session_id
       FROM sessions
       WHERE expires_at <= $1
         AND active_job_count = 0
         AND deleting = false
       ORDER BY expires_at ASC`,
      [referenceIso]
    );
    return result.rows.map((row: { session_id: string }) => String(row.session_id));
  }

  private async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        active_job_count INTEGER NOT NULL DEFAULT 0,
        deleting BOOLEAN NOT NULL DEFAULT false
      );

      CREATE TABLE IF NOT EXISTS session_files (
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        size BIGINT NOT NULL,
        content_type TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, path)
      );

      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        exit_code INTEGER,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        duration_ms INTEGER,
        files_uploaded_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        request_json TEXT NOT NULL
      );
    `);

    const restartedAt = nowIso();
    await this.pool.query(
      `UPDATE jobs
       SET status = 'failed',
           stderr = CASE
             WHEN stderr = '' THEN 'Service restarted before job completion'
             ELSE stderr || E'\\nService restarted before job completion'
           END,
           completed_at = COALESCE(completed_at, $1)
       WHERE status IN ('queued', 'running')`,
      [restartedAt]
    );
    await this.pool.query(`UPDATE sessions SET active_job_count = 0, deleting = false`);
  }
}

function mapSession(row: Record<string, unknown>): SessionRecord {
  return {
    sessionId: String(row.session_id),
    createdAt: String(row.created_at),
    lastAccessedAt: String(row.last_accessed_at),
    expiresAt: String(row.expires_at),
    activeJobCount: Number(row.active_job_count),
    deleting: Boolean(row.deleting)
  };
}

function mapSessionFile(row: Record<string, unknown>): SessionFileRecord {
  return {
    sessionId: String(row.session_id),
    path: String(row.path),
    size: Number(row.size),
    contentType: row.content_type === null ? null : String(row.content_type),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapJob(row: Record<string, unknown>): JobRecord {
  return {
    jobId: String(row.job_id),
    sessionId: String(row.session_id),
    status: row.status as JobRecord["status"],
    exitCode: row.exit_code === null ? null : Number(row.exit_code),
    stdout: String(row.stdout),
    stderr: String(row.stderr),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    filesUploaded: JSON.parse(String(row.files_uploaded_json)) as string[],
    createdAt: String(row.created_at),
    startedAt: row.started_at === null ? null : String(row.started_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
    request: JSON.parse(String(row.request_json)) as ExecutionRequest
  };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown execution error";
}
