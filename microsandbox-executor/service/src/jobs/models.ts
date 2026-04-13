import { z } from "zod";

import { normalizeRelativePath } from "../util/fs.js";

const executionRequestBaseSchema = z.object({
  session_id: z.string().min(1),
  file_paths: z.array(z.string().min(1)).optional(),
  job_id: z.string().min(1).optional(),
  timeout_seconds: z.coerce.number().int().positive().optional(),
  cpu_limit: z.coerce.number().int().positive().optional(),
  memory_mb: z.coerce.number().int().positive().optional(),
  network_mode: z.enum(["none", "allowlist", "public"]).default("none"),
  allowed_hosts: z.array(z.string().min(1)).default([]),
  environment: z.record(z.string(), z.string()).default({})
});

function validateExecutionRequest(
  value: z.infer<typeof executionRequestBaseSchema>,
  context: z.RefinementCtx
) {
  if (value.network_mode === "allowlist" && value.allowed_hosts.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "allowed_hosts is required when network_mode is allowlist",
      path: ["allowed_hosts"]
    });
  }

  value.file_paths?.forEach((filePath, index) => {
    try {
      normalizeRelativePath(filePath);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid file path",
        path: ["file_paths", index]
      });
    }
  });
}

export const executeRequestSchema = executionRequestBaseSchema
  .extend({
    code: z.string(),
    entrypoint: z.string().min(1).default("main.py"),
    python_profile: z.enum(["default", "data-science"]).default("default"),
    restricted_exec: z.boolean().optional()
  })
  .superRefine(validateExecutionRequest)
  .transform((value) => ({
    sessionId: value.session_id,
    filePaths: value.file_paths,
    jobId: value.job_id,
    code: value.code,
    entrypoint: value.entrypoint,
    pythonProfile: value.python_profile,
    timeoutSeconds: value.timeout_seconds,
    cpuLimit: value.cpu_limit,
    memoryMb: value.memory_mb,
    networkMode: value.network_mode,
    allowedHosts: value.allowed_hosts,
    environment: value.environment,
    restrictedExec: value.restricted_exec,
    kind: "python" as const
  }));

export const executeBashRequestSchema = executionRequestBaseSchema
  .extend({
    script: z.string(),
    entrypoint: z.string().min(1).default("main.sh")
  })
  .superRefine(validateExecutionRequest)
  .transform((value) => ({
    sessionId: value.session_id,
    filePaths: value.file_paths,
    jobId: value.job_id,
    script: value.script,
    entrypoint: value.entrypoint,
    timeoutSeconds: value.timeout_seconds,
    cpuLimit: value.cpu_limit,
    memoryMb: value.memory_mb,
    networkMode: value.network_mode,
    allowedHosts: value.allowed_hosts,
    environment: value.environment,
    kind: "bash" as const
  }));

export type ExecuteRequest = z.infer<typeof executeRequestSchema>;
export type ExecuteBashRequest = z.infer<typeof executeBashRequestSchema>;
export type ExecutionRequest = ExecuteRequest | ExecuteBashRequest;

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobRecord {
  jobId: string;
  sessionId: string;
  status: JobStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number | null;
  filesUploaded: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  request: ExecutionRequest;
}

export interface ApiJobResponse {
  job_id: string;
  session_id: string;
  status: JobStatus;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number | null;
  files_uploaded: string[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export function toApiJobResponse(record: JobRecord): ApiJobResponse {
  return {
    job_id: record.jobId,
    session_id: record.sessionId,
    status: record.status,
    exit_code: record.exitCode,
    stdout: record.stdout,
    stderr: record.stderr,
    duration_ms: record.durationMs,
    files_uploaded: record.filesUploaded,
    created_at: record.createdAt,
    started_at: record.startedAt,
    completed_at: record.completedAt
  };
}
