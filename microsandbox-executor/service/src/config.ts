import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseDotenv } from "dotenv";
import { z } from "zod";

const booleanEnv = (defaultValue?: boolean) =>
  z.preprocess((value) => {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();

      if (["true", "1", "yes", "on"].includes(normalized)) {
        return true;
      }

      if (["false", "0", "no", "off"].includes(normalized)) {
        return false;
      }
    }

    return value;
  }, z.boolean());

const envSchema = z.object({
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  MICROSANDBOX_IMAGE: z.string().min(1).default("hari31416/sandbox-data-science:py312-v1"),
  MICROSANDBOX_IMAGE_DATA_SCIENCE: z.string().min(1).default("hari31416/sandbox-data-science:py312-v1"),
  SCRATCH_ROOT: z.string().min(1).default("/tmp/agent-sandbox"),
  EXECUTOR_DATABASE_URL: z.string().min(1).default("postgresql://deepagent:deepagent_password@localhost:5432/deepagent"),
  MINIO_END_POINT: z.string().min(1).default("localhost"),
  MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  MINIO_ACCESS_KEY: z.string().min(1).default("minioadmin"),
  MINIO_SECRET_KEY: z.string().min(1).default("minioadminpassword"),
  MINIO_BUCKET: z.string().min(1).default("deepagent"),
  MINIO_USE_SSL: booleanEnv().default(false),
  MINIO_SESSION_PREFIX: z.string().min(1).default("executor-sessions"),
  GUEST_WORKSPACE_PATH: z.string().min(1).default("/workspace"),
  DEFAULT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
  MAX_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  DEFAULT_CPU_LIMIT: z.coerce.number().int().positive().default(1),
  MAX_CPU_LIMIT: z.coerce.number().int().positive().default(4),
  DEFAULT_MEMORY_MB: z.coerce.number().int().positive().default(2048),
  MAX_MEMORY_MB: z.coerce.number().int().positive().default(4096),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(24 * 60 * 60),
  SESSION_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(10 * 60),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  MAX_FILES_PER_UPLOAD: z.coerce.number().int().positive().default(10),
  ENABLE_RESTRICTED_EXEC: booleanEnv().default(false),
  RESTRICTED_EXEC_BLOCKED_IMPORTS: z.string().default("subprocess,socket,multiprocessing,resource,pty"),
  HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000)
});

export type AppConfig = ReturnType<typeof loadConfig>;

const SERVICE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO_ROOT = resolve(SERVICE_ROOT, "..");
const ROOT_ENV_FILE = resolve(REPO_ROOT, ".env");

export function loadEnvFile(explicitPath = process.env.ENV_FILE) {
  const shellKeys = new Set(Object.keys(process.env));
  const loadedPaths: string[] = [];

  applyEnvFile(ROOT_ENV_FILE, shellKeys, loadedPaths);

  if (explicitPath) {
    applyEnvFile(resolve(explicitPath), shellKeys, loadedPaths);
  }

  return loadedPaths;
}

function applyEnvFile(envFilePath: string, shellKeys: Set<string>, loadedPaths: string[]) {
  if (!existsSync(envFilePath)) {
    return;
  }

  const parsed = parseDotenv(readFileSync(envFilePath));

  for (const [key, value] of Object.entries(parsed)) {
    if (!shellKeys.has(key)) {
      process.env[key] = value;
    }
  }

  loadedPaths.push(envFilePath);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);

  return {
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    runtimeImages: {
      default: parsed.MICROSANDBOX_IMAGE,
      "data-science": parsed.MICROSANDBOX_IMAGE_DATA_SCIENCE
    },
    scratchRoot: parsed.SCRATCH_ROOT,
    databaseUrl: parsed.EXECUTOR_DATABASE_URL,
    minio: {
      endPoint: parsed.MINIO_END_POINT,
      port: parsed.MINIO_PORT,
      accessKey: parsed.MINIO_ACCESS_KEY,
      secretKey: parsed.MINIO_SECRET_KEY,
      bucket: parsed.MINIO_BUCKET,
      useSSL: parsed.MINIO_USE_SSL,
      sessionPrefix: parsed.MINIO_SESSION_PREFIX
    },
    guestWorkspacePath: parsed.GUEST_WORKSPACE_PATH,
    defaultTimeoutSeconds: parsed.DEFAULT_TIMEOUT_SECONDS,
    maxTimeoutSeconds: parsed.MAX_TIMEOUT_SECONDS,
    defaultCpuLimit: parsed.DEFAULT_CPU_LIMIT,
    maxCpuLimit: parsed.MAX_CPU_LIMIT,
    defaultMemoryMb: parsed.DEFAULT_MEMORY_MB,
    maxMemoryMb: parsed.MAX_MEMORY_MB,
    sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
    sessionCleanupIntervalSeconds: parsed.SESSION_CLEANUP_INTERVAL_SECONDS,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    maxFilesPerUpload: parsed.MAX_FILES_PER_UPLOAD,
    enableRestrictedExec: parsed.ENABLE_RESTRICTED_EXEC,
    blockedImports: parsed.RESTRICTED_EXEC_BLOCKED_IMPORTS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    healthcheckTimeoutMs: parsed.HEALTHCHECK_TIMEOUT_MS
  };
}
