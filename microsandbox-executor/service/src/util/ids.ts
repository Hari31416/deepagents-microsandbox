import { createHash, randomUUID } from "node:crypto";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export function createSessionId() {
  return `sess_${randomUUID()}`;
}

export function createJobId() {
  return `job_${randomUUID()}`;
}

export function createSandboxName(jobId: string) {
  const digest = createHash("sha256").update(jobId).digest("hex").slice(0, 12);
  return `exec-${digest}`;
}

export function validateSessionId(sessionId: string) {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error("Invalid session_id");
  }
}

export function sanitizeUploadedFilename(filename: string) {
  const normalizedSeparators = filename.replaceAll("\\", "/").trim();
  const sanitized = normalizedSeparators
    .replace(/[^a-zA-Z0-9._/-]/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/g, "");

  if (sanitized.length === 0 || sanitized === ".") {
    return "upload.bin";
  }

  return sanitized;
}
