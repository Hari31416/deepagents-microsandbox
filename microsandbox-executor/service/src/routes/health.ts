import type { FastifyInstance } from "fastify";

import type { AppServices } from "../app.js";

export async function registerHealthRoutes(app: FastifyInstance, services: AppServices) {
  app.get("/v1/health", async () => {
    const [runtime, storage, metadata] = await Promise.all([
      services.runtime.healthCheck(),
      services.storage.healthCheck(),
      services.metadata.healthCheck()
    ]);

    return {
      status: runtime.ok && storage.ok && metadata.ok ? "ok" : "degraded",
      runtime,
      storage,
      metadata
    };
  });
}
