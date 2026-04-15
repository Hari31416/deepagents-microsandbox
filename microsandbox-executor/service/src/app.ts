import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import type { AppConfig } from "./config.js";
import { JobExecutor } from "./jobs/executor.js";
import type { MetadataStore } from "./metadata/types.js";
import type { SandboxRuntime } from "./runtime/types.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { SessionCleanupService } from "./sessions/cleanup.js";
import { SessionLockManager } from "./sessions/locks.js";
import { SessionRuntimeManager } from "./sessions/runtime_manager.js";
import { WorkspaceSync } from "./storage/sync.js";
import type { SessionStorage } from "./storage/types.js";
import { registerExecuteRoutes } from "./routes/execute.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { createLoggerOptions } from "./util/logging.js";

export interface AppServices {
  config: AppConfig;
  runtime: SandboxRuntime;
  storage: SessionStorage;
  metadata: MetadataStore;
  locks: SessionLockManager;
  cleanup: SessionCleanupService;
  runtimeManager: SessionRuntimeManager;
  sync: WorkspaceSync;
  executor: JobExecutor;
}

export async function buildApp(services: AppServices) {
  const app = Fastify({
    logger: createLoggerOptions(services.config)
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Sandbox Executor API",
        description: "HTTP API for managing sandbox sessions, uploads, execution, artifacts, and health checks.",
        version: "0.1.0"
      },
      servers: [
        {
          url: "/"
        }
      ]
    }
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true
    }
  });

  await registerHealthRoutes(app, services);
  await registerSessionRoutes(app, services);
  await registerExecuteRoutes(app, services);
  await registerJobRoutes(app, services);
  app.addHook("onClose", async () => {
    services.cleanup.stop();
    await services.runtimeManager.shutdown();
    await services.metadata.close();
  });
  await app.ready();

  return app;
}
