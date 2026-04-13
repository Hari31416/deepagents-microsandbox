import { buildApp } from "./app.js";
import { loadConfig, loadEnvFile } from "./config.js";
import { JobExecutor } from "./jobs/executor.js";
import { MetadataStore } from "./metadata/store.js";
import { MicrosandboxRuntime } from "./runtime/microsandbox_runtime.js";
import { SessionCleanupService } from "./sessions/cleanup.js";
import { SessionLockManager } from "./sessions/locks.js";
import { LocalSessionStorage } from "./storage/local.js";
import { WorkspaceSync } from "./storage/sync.js";

async function main() {
  loadEnvFile();
  const config = loadConfig();
  const runtime = new MicrosandboxRuntime();
  const storage = new LocalSessionStorage(config.sessionStorageRoot);
  const metadata = await MetadataStore.create(config.sqliteDbPath, config.sessionTtlSeconds);
  const locks = new SessionLockManager();
  const sync = new WorkspaceSync(storage);
  const cleanup = new SessionCleanupService(config, storage, metadata, locks);
  const executor = new JobExecutor(config, runtime, sync, metadata, locks);

  const app = await buildApp({
    config,
    runtime,
    storage,
    metadata,
    locks,
    cleanup,
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
