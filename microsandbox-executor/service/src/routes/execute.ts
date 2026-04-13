import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { AppServices } from "../app.js";
import { executeBashRequestSchema, executeRequestSchema, toApiJobResponse } from "../jobs/models.js";

export async function registerExecuteRoutes(app: FastifyInstance, services: AppServices) {
  app.post("/v1/execute", async (request, reply) => {
    try {
      const payload = executeRequestSchema.parse(request.body);
      const existingJob = payload.jobId ? services.executor.get(payload.jobId) : null;

      if (existingJob) {
        return reply.code(409).send({
          error: "Job already exists",
          job_id: payload.jobId
        });
      }

      const record = await services.executor.execute(payload);
      return reply.send(toApiJobResponse(record));
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "Invalid request",
          issues: error.flatten()
        });
      }

      if (error instanceof Error && error.message.startsWith("Unknown session:")) {
        return reply.code(404).send({
          error: error.message
        });
      }

      request.log.error({ err: error }, "execution request failed");
      return reply.code(500).send({
        error: error instanceof Error ? error.message : "Internal server error"
      });
    }
  });

  app.post("/v1/execute/bash", async (request, reply) => {
    try {
      const payload = executeBashRequestSchema.parse(request.body);
      const existingJob = payload.jobId ? services.executor.get(payload.jobId) : null;

      if (existingJob) {
        return reply.code(409).send({
          error: "Job already exists",
          job_id: payload.jobId
        });
      }

      const record = await services.executor.executeBash(payload);
      return reply.send(toApiJobResponse(record));
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "Invalid request",
          issues: error.flatten()
        });
      }

      if (error instanceof Error && error.message.startsWith("Unknown session:")) {
        return reply.code(404).send({
          error: error.message
        });
      }

      request.log.error({ err: error }, "bash execution request failed");
      return reply.code(500).send({
        error: error instanceof Error ? error.message : "Internal server error"
      });
    }
  });
}
