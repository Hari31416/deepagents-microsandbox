import { buildApp } from "./app.js";
import { loadConfig, loadEnvFile } from "./config.js";
import { JobExecutor } from "./jobs/executor.js";
import { PostgresMetadataStore } from "./metadata/postgres_store.js";
import { MicrosandboxRuntime } from "./runtime/microsandbox_runtime.js";
import { SessionCleanupService } from "./sessions/cleanup.js";
import { SessionLockManager } from "./sessions/locks.js";
import { SessionRuntimeManager } from "./sessions/runtime_manager.js";
import { Client } from "minio";
import { MinioSessionStorage } from "./storage/minio.js";
import { WorkspaceSync } from "./storage/sync.js";

async function main() {
  loadEnvFile();
  const config = loadConfig();
  const runtime = new MicrosandboxRuntime();
  const minioClient = new Client({
    endPoint: config.minio.endPoint,
    port: config.minio.port,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
    useSSL: config.minio.useSSL
  });
  const storage = new MinioSessionStorage(minioClient, config.minio.bucket, config.minio.sessionPrefix);
  const metadata = await PostgresMetadataStore.create(config.databaseUrl, config.sessionTtlSeconds);
  const locks = new SessionLockManager();
  const sync = new WorkspaceSync(storage);
  const runtimeManager = new SessionRuntimeManager(config, runtime, sync, storage, metadata);
  await runtimeManager.reconcileStartup();
  const cleanup = new SessionCleanupService(config, storage, metadata, locks, runtimeManager);
  const executor = new JobExecutor(config, runtime, metadata, locks, runtimeManager);

  const app = await buildApp({
    config,
    runtime,
    storage,
    metadata,
    locks,
    cleanup,
    runtimeManager,
    sync,
    executor
  });
  await cleanup.start();

  await app.listen({
    host: config.host,
    port: config.port
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
