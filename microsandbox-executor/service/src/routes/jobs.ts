import type { FastifyInstance } from "fastify";

import type { AppServices } from "../app.js";
import { toApiJobResponse } from "../jobs/models.js";

export async function registerJobRoutes(app: FastifyInstance, services: AppServices) {
  app.get("/v1/jobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId?: string };

    if (!params.jobId) {
      return reply.code(400).send({ error: "jobId is required" });
    }

    const record = services.executor.get(params.jobId);

    if (!record) {
      return reply.code(404).send({ error: "Job not found" });
    }

    return reply.send(toApiJobResponse(record));
  });
}
