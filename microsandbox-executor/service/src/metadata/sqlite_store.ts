import { dirname } from "node:path";
import Database from "better-sqlite3";

import { ensureDir } from "../util/fs.js";
import type { ExecutionRequest, JobRecord } from "../jobs/models.js";
import type {
  MetadataHealth,
  MetadataStore,
  SessionFileRecord,
  SessionRecord,
  SessionRuntimeLeaseRecord
} from "./types.js";

function nowIso() {
  return new Date().toISOString();
}

function expiresAtIso(ttlSeconds: number) {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

export class SqliteMetadataStore implements MetadataStore {
  private readonly db: InstanceType<typeof Database>;

  constructor(private readonly dbPath: string, private readonly sessionTtlSeconds: number) {
    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  static async create(dbPath: string, sessionTtlSeconds: number) {
    await ensureDir(dirname(dbPath));
    return new SqliteMetadataStore(dbPath, sessionTtlSeconds);
  }

  close() {
    this.db.close();
  }

  healthCheck(): MetadataHealth {
    try {
      this.db.prepare("SELECT 1").get();
      return {
        ok: true,
        details: "sqlite metadata store ready"
      };
    } catch (error) {
      return {
        ok: false,
        details: error instanceof Error ? error.message : "sqlite metadata store unavailable"
      };
    }
  }

  createSession(sessionId: string) {
    const createdAt = nowIso();
    const expiresAt = expiresAtIso(this.sessionTtlSeconds);
    this.db
      .prepare(
        `INSERT INTO sessions (
          session_id,
          created_at,
          last_accessed_at,
          expires_at,
          active_job_count,
          deleting
        ) VALUES (?, ?, ?, ?, 0, 0)`
      )
      .run(sessionId, createdAt, createdAt, expiresAt);
    return this.getRequiredSession(sessionId);
  }

  getSession(sessionId: string) {
    const row = this.db
      .prepare(
        `SELECT session_id, created_at, last_accessed_at, expires_at, active_job_count, deleting
         FROM sessions WHERE session_id = ?`
      )
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? mapSession(row) : null;
  }

  getRequiredSession(sessionId: string) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  touchSession(sessionId: string) {
    const touchedAt = nowIso();
    const result = this.db
      .prepare(
        `UPDATE sessions
         SET last_accessed_at = ?, expires_at = ?
         WHERE session_id = ?`
      )
      .run(touchedAt, expiresAtIso(this.sessionTtlSeconds), sessionId);
    if (result.changes === 0) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
  }

  incrementActiveJobCount(sessionId: string) {
    this.touchSession(sessionId);
    this.db.prepare(`UPDATE sessions SET active_job_count = active_job_count + 1 WHERE session_id = ?`).run(sessionId);
  }

  decrementActiveJobCount(sessionId: string) {
    this.touchSession(sessionId);
    this.db
      .prepare(
        `UPDATE sessions
         SET active_job_count = CASE WHEN active_job_count > 0 THEN active_job_count - 1 ELSE 0 END
         WHERE session_id = ?`
      )
      .run(sessionId);
  }

  markSessionDeleting(sessionId: string) {
    const result = this.db
      .prepare(
        `UPDATE sessions
         SET deleting = 1
         WHERE session_id = ?
           AND active_job_count = 0
           AND deleting = 0`
      )
      .run(sessionId);
    return result.changes > 0;
  }

  clearSessionDeleting(sessionId: string) {
    this.db.prepare(`UPDATE sessions SET deleting = 0 WHERE session_id = ?`).run(sessionId);
  }

  deleteSession(sessionId: string) {
    this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
  }

  upsertFile(sessionId: string, path: string, size: number, contentType: string | null, checksum: string | null = null) {
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO session_files (
          session_id, path, size, content_type, checksum, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, path) DO UPDATE SET
          size = excluded.size,
          content_type = excluded.content_type,
          checksum = excluded.checksum,
          updated_at = excluded.updated_at`
      )
      .run(sessionId, path, size, contentType, checksum, timestamp, timestamp);
  }

  deleteFile(sessionId: string, path: string) {
    this.db.prepare(`DELETE FROM session_files WHERE session_id = ? AND path = ?`).run(sessionId, path);
  }

  listFiles(sessionId: string): SessionFileRecord[] {
    const rows = this.db
      .prepare(
        `SELECT session_id, path, size, content_type, checksum, created_at, updated_at
         FROM session_files WHERE session_id = ? ORDER BY path ASC`
      )
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(mapSessionFile);
  }

  getFile(sessionId: string, path: string) {
    const row = this.db
      .prepare(
        `SELECT session_id, path, size, content_type, checksum, created_at, updated_at
         FROM session_files
         WHERE session_id = ? AND path = ?`
      )
      .get(sessionId, path) as Record<string, unknown> | undefined;
    return row ? mapSessionFile(row) : null;
  }

  getSessionRuntime(sessionId: string) {
    const row = this.db
      .prepare(
        `SELECT
           session_id, sandbox_name, workspace_path, image, cpu_limit, memory_mb,
           network_mode, allowed_hosts_key, hydrated, dirty, created_at, updated_at, last_used_at
         FROM session_runtime_leases
         WHERE session_id = ?`
      )
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? mapSessionRuntime(row) : null;
  }

  upsertSessionRuntime(runtime: SessionRuntimeLeaseRecord) {
    this.db
      .prepare(
        `INSERT INTO session_runtime_leases (
          session_id, sandbox_name, workspace_path, image, cpu_limit, memory_mb,
          network_mode, allowed_hosts_key, hydrated, dirty, created_at, updated_at, last_used_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          sandbox_name = excluded.sandbox_name,
          workspace_path = excluded.workspace_path,
          image = excluded.image,
          cpu_limit = excluded.cpu_limit,
          memory_mb = excluded.memory_mb,
          network_mode = excluded.network_mode,
          allowed_hosts_key = excluded.allowed_hosts_key,
          hydrated = excluded.hydrated,
          dirty = excluded.dirty,
          updated_at = excluded.updated_at,
          last_used_at = excluded.last_used_at`
      )
      .run(
        runtime.sessionId,
        runtime.sandboxName,
        runtime.workspacePath,
        runtime.image,
        runtime.cpuLimit,
        runtime.memoryMb,
        runtime.networkMode,
        runtime.allowedHostsKey,
        runtime.hydrated ? 1 : 0,
        runtime.dirty ? 1 : 0,
        runtime.createdAt,
        runtime.updatedAt,
        runtime.lastUsedAt
      );
  }

  deleteSessionRuntime(sessionId: string) {
    this.db.prepare(`DELETE FROM session_runtime_leases WHERE session_id = ?`).run(sessionId);
  }

  listSessionRuntimes(): SessionRuntimeLeaseRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           session_id, sandbox_name, workspace_path, image, cpu_limit, memory_mb,
           network_mode, allowed_hosts_key, hydrated, dirty, created_at, updated_at, last_used_at
         FROM session_runtime_leases
         ORDER BY session_id ASC`
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapSessionRuntime);
  }

  createJob(jobId: string, request: ExecutionRequest) {
    if (this.getJob(jobId)) {
      throw new Error(`Job already exists: ${jobId}`);
    }
    const createdAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO jobs (
          job_id, session_id, status, exit_code, stdout, stderr, duration_ms, files_uploaded_json,
          created_at, started_at, completed_at, request_json
        ) VALUES (?, ?, 'queued', NULL, '', '', NULL, '[]', ?, NULL, NULL, ?)`
      )
      .run(jobId, request.sessionId, createdAt, JSON.stringify(request));
    return this.getRequiredJob(jobId);
  }

  markJobRunning(jobId: string) {
    const startedAt = nowIso();
    const result = this.db.prepare(`UPDATE jobs SET status = 'running', started_at = ? WHERE job_id = ?`).run(startedAt, jobId);
    if (result.changes === 0) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    return this.getRequiredJob(jobId);
  }

  completeJob(jobId: string, result: Pick<JobRecord, "exitCode" | "stdout" | "stderr" | "durationMs" | "filesUploaded">) {
    const completedAt = nowIso();
    const update = this.db
      .prepare(
        `UPDATE jobs
         SET status = 'completed',
             exit_code = ?,
             stdout = ?,
             stderr = ?,
             duration_ms = ?,
             files_uploaded_json = ?,
             completed_at = ?
         WHERE job_id = ?`
      )
      .run(result.exitCode, result.stdout, result.stderr, result.durationMs, JSON.stringify(result.filesUploaded), completedAt, jobId);
    if (update.changes === 0) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    return this.getRequiredJob(jobId);
  }

  failJob(jobId: string, error: unknown, result?: Partial<Pick<JobRecord, "exitCode" | "stdout" | "stderr" | "durationMs" | "filesUploaded">>) {
    const current = this.getRequiredJob(jobId);
    const completedAt = nowIso();
    const update = this.db
      .prepare(
        `UPDATE jobs
         SET status = 'failed',
             exit_code = ?,
             stdout = ?,
             stderr = ?,
             duration_ms = ?,
             files_uploaded_json = ?,
             completed_at = ?
         WHERE job_id = ?`
      )
      .run(
        result?.exitCode ?? current.exitCode,
        result?.stdout ?? current.stdout,
        result?.stderr ?? formatError(error),
        result?.durationMs ?? current.durationMs,
        JSON.stringify(result?.filesUploaded ?? current.filesUploaded),
        completedAt,
        jobId
      );
    if (update.changes === 0) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    return this.getRequiredJob(jobId);
  }

  getJob(jobId: string) {
    const row = this.db
      .prepare(
        `SELECT job_id, session_id, status, exit_code, stdout, stderr, duration_ms,
                files_uploaded_json, created_at, started_at, completed_at, request_json
         FROM jobs WHERE job_id = ?`
      )
      .get(jobId) as Record<string, unknown> | undefined;
    return row ? mapJob(row) : null;
  }

  getRequiredJob(jobId: string) {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    return job;
  }

  listExpiredSessionIds(referenceIso = nowIso()) {
    const rows = this.db
      .prepare(
        `SELECT session_id
         FROM sessions
         WHERE expires_at <= ?
           AND active_job_count = 0
           AND deleting = 0
         ORDER BY expires_at ASC`
      )
      .all(referenceIso) as Array<{ session_id: string }>;
    return rows.map((row) => row.session_id);
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        active_job_count INTEGER NOT NULL DEFAULT 0,
        deleting INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS session_files (
        session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        content_type TEXT,
        checksum TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, path),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS session_runtime_leases (
        session_id TEXT PRIMARY KEY,
        sandbox_name TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        image TEXT NOT NULL,
        cpu_limit INTEGER NOT NULL,
        memory_mb INTEGER NOT NULL,
        network_mode TEXT NOT NULL,
        allowed_hosts_key TEXT NOT NULL,
        hydrated INTEGER NOT NULL DEFAULT 0,
        dirty INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        exit_code INTEGER,
        stdout TEXT NOT NULL,
        stderr TEXT NOT NULL,
        duration_ms INTEGER,
        files_uploaded_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        request_json TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );
    `);

    this.ensureColumn("session_files", "checksum", "TEXT");

    const restartedAt = nowIso();
    this.db
      .prepare(
        `UPDATE jobs
         SET status = 'failed',
             stderr = CASE
               WHEN stderr = '' THEN 'Service restarted before job completion'
               ELSE stderr || '\nService restarted before job completion'
             END,
             completed_at = COALESCE(completed_at, ?)
         WHERE status IN ('queued', 'running')`
      )
      .run(restartedAt);
    this.db.exec("UPDATE sessions SET active_job_count = 0, deleting = 0");
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
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
    checksum: row.checksum === null ? null : String(row.checksum),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSessionRuntime(row: Record<string, unknown>): SessionRuntimeLeaseRecord {
  return {
    sessionId: String(row.session_id),
    sandboxName: String(row.sandbox_name),
    workspacePath: String(row.workspace_path),
    image: String(row.image),
    cpuLimit: Number(row.cpu_limit),
    memoryMb: Number(row.memory_mb),
    networkMode: String(row.network_mode) as SessionRuntimeLeaseRecord["networkMode"],
    allowedHostsKey: String(row.allowed_hosts_key),
    hydrated: Number(row.hydrated) === 1,
    dirty: Number(row.dirty) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastUsedAt: String(row.last_used_at)
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
