import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { basename } from "node:path";
import { stat } from "node:fs/promises";
import { ZodError, z } from "zod";

import type { AppServices } from "../app.js";
import { normalizeRelativePath, resolveWithin, writeStreamToFile } from "../util/fs.js";
import { createSessionId, sanitizeUploadedFilename, validateSessionId } from "../util/ids.js";

const createSessionSchema = z
  .object({
    session_id: z.string().min(1).optional()
  })
  .optional();

export async function registerSessionRoutes(app: FastifyInstance, services: AppServices) {
  await app.register(multipart, {
    preservePath: true,
    limits: {
      fileSize: services.config.maxUploadBytes,
      files: services.config.maxFilesPerUpload
    }
  });

  app.post("/v1/sessions", async (request, reply) => {
    try {
      const payload = createSessionSchema.parse(request.body ?? {});
      const sessionId = payload?.session_id ?? createSessionId();
      validateSessionId(sessionId);
      const session = services.metadata.createSession(sessionId);
      await services.storage.ensureSessionRoot(sessionId);

      return reply.code(201).send({
        session_id: session.sessionId,
        created_at: session.createdAt,
        expires_at: session.expiresAt
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "Invalid request", issues: error.flatten() });
      }

      if (isSqliteConstraintError(error)) {
        return reply.code(409).send({
          error: "Session already exists"
        });
      }

      request.log.error({ err: error }, "session creation failed");
      return reply.code(500).send({
        error: error instanceof Error ? error.message : "Internal server error"
      });
    }
  });

  app.post("/v1/sessions/:sessionId/files", async (request, reply) => {
    const params = request.params as { sessionId?: string };
    const sessionId = params.sessionId;

    if (!sessionId) {
      return reply.code(400).send({ error: "sessionId is required" });
    }

    try {
      validateSessionId(sessionId);
      const payload = await services.locks.runExclusive(sessionId, async () => {
        services.metadata.getRequiredSession(sessionId);
        await services.storage.ensureSessionRoot(sessionId);

        const parts = request.parts();
        const uploadedFiles: Array<{ path: string; size: number; content_type: string | null; updated_at: string }> = [];

        for await (const part of parts) {
          if (part.type !== "file") {
            continue;
          }

          const relativePath = normalizeRelativePath(sanitizeUploadedFilename(part.filename ?? "upload.bin"));
          const destinationPath = resolveWithin(services.storage.resolveSessionRoot(sessionId), relativePath);

          await writeStreamToFile(part.file, destinationPath);
          const stats = await stat(destinationPath);
          services.metadata.upsertFile(sessionId, relativePath, stats.size, part.mimetype ?? null);
          uploadedFiles.push({
            path: relativePath,
            size: stats.size,
            content_type: part.mimetype ?? null,
            updated_at: new Date(stats.mtimeMs).toISOString()
          });
        }

        if (uploadedFiles.length === 0) {
          throw new Error("At least one file is required");
        }

        services.metadata.touchSession(sessionId);

        return {
          session_id: sessionId,
          file_paths: uploadedFiles.map((file) => file.path),
          files: uploadedFiles
        };
      });

      return reply.code(201).send(payload);
    } catch (error) {
      request.log.error({ err: error }, "file upload failed");
      return reply.code(resolveSessionErrorStatus(error, 500)).send({
        error: error instanceof Error ? error.message : "Internal server error"
      });
    }
  });

  app.get("/v1/sessions/:sessionId/files", async (request, reply) => {
    const params = request.params as { sessionId?: string };
    const sessionId = params.sessionId;

    if (!sessionId) {
      return reply.code(400).send({ error: "sessionId is required" });
    }

    try {
      validateSessionId(sessionId);
      const files = await services.locks.runExclusive(sessionId, async () => {
        services.metadata.getRequiredSession(sessionId);
        services.metadata.touchSession(sessionId);
        return services.metadata.listFiles(sessionId);
      });

      return reply.send({
        session_id: sessionId,
        files: files.map((file) => ({
          path: file.path,
          size: file.size,
          content_type: file.contentType,
          created_at: file.createdAt,
          updated_at: file.updatedAt
        }))
      });
    } catch (error) {
      return reply.code(resolveSessionErrorStatus(error, 404)).send({
        error: error instanceof Error ? error.message : "Session not found"
      });
    }
  });

  app.get("/v1/sessions/:sessionId/files/*", async (request, reply) => {
    const params = request.params as { sessionId?: string; "*": string };
    const sessionId = params.sessionId;

    if (!sessionId) {
      return reply.code(400).send({ error: "sessionId is required" });
    }

    try {
      validateSessionId(sessionId);
      const relativePath = normalizeRelativePath(params["*"]);
      const file = await services.locks.runExclusive(sessionId, async () => {
        services.metadata.getRequiredSession(sessionId);
        services.metadata.touchSession(sessionId);
        const metadata = services.metadata.getFile(sessionId, relativePath);

        if (!metadata) {
          throw new Error("File not found");
        }

        const download = await services.storage.openDownload(sessionId, relativePath);

        return {
          metadata,
          download
        };
      });

      reply.header("content-type", file.metadata.contentType ?? inferContentType(relativePath));
      reply.header("content-length", String(file.download.size));
      reply.header("content-disposition", `attachment; filename="${basename(relativePath)}"`);
      return reply.send(file.download.stream);
    } catch (error) {
      return reply.code(resolveSessionErrorStatus(error, 404)).send({
        error: error instanceof Error ? error.message : "File not found"
      });
    }
  });

  app.delete("/v1/sessions/:sessionId", async (request, reply) => {
    const params = request.params as { sessionId?: string };
    const sessionId = params.sessionId;

    if (!sessionId) {
      return reply.code(400).send({ error: "sessionId is required" });
    }

    try {
      validateSessionId(sessionId);
      await services.locks.runExclusive(sessionId, async () => {
        const session = services.metadata.getRequiredSession(sessionId);

        if (session.activeJobCount > 0) {
          throw new Error("Session has active jobs");
        }

        if (!services.metadata.markSessionDeleting(sessionId)) {
          throw new Error("Session cannot be deleted right now");
        }

        await services.storage.deleteSession(sessionId);
        services.metadata.deleteSession(sessionId);
      });

      return reply.code(204).send();
    } catch (error) {
      return reply.code(resolveSessionErrorStatus(error, 404)).send({
        error: error instanceof Error ? error.message : "Session deletion failed"
      });
    }
  });
}

function inferContentType(path: string) {
  if (path.endsWith(".csv")) {
    return "text/csv; charset=utf-8";
  }

  if (path.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  if (path.endsWith(".txt") || path.endsWith(".log") || path.endsWith(".py")) {
    return "text/plain; charset=utf-8";
  }

  return "application/octet-stream";
}

function resolveSessionErrorStatus(error: unknown, fallbackStatus: number) {
  if (!(error instanceof Error)) {
    return fallbackStatus;
  }

  if (error.message === "Invalid session_id" || error.message === "At least one file is required") {
    return 400;
  }

  if (error.message.startsWith("Unknown session:") || error.message === "File not found") {
    return 404;
  }

  if (
    error.message === "Session has active jobs" ||
    error.message === "Session already exists" ||
    error.message === "Session cannot be deleted right now"
  ) {
    return 409;
  }

  return fallbackStatus;
}

function isSqliteConstraintError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("unique constraint");
}
