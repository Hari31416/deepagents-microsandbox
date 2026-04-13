import type { FastifyServerOptions } from "fastify";

import type { AppConfig } from "../config.js";

export function createLoggerOptions(config: AppConfig): FastifyServerOptions["logger"] {
  return {
    level: config.logLevel
  };
}
