import type { AppConfig } from "../config.js";
import type { MetadataStore } from "../metadata/types.js";
import type { SessionStorage } from "../storage/types.js";
import { SessionLockManager } from "./locks.js";
import { SessionRuntimeManager } from "./runtime_manager.js";

export class SessionCleanupService {
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly storage: SessionStorage,
    private readonly metadata: MetadataStore,
    private readonly locks: SessionLockManager,
    private readonly runtimeManager: SessionRuntimeManager
  ) {}

  async start() {
    await this.runOnce();
    this.intervalHandle = setInterval(() => {
      void this.runOnce();
    }, this.config.sessionCleanupIntervalSeconds * 1000);
    this.intervalHandle.unref();
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async runOnce() {
    const expiredSessionIds = await this.metadata.listExpiredSessionIds();

    for (const sessionId of expiredSessionIds) {
      await this.locks.runExclusive(sessionId, async () => {
        if (!(await this.metadata.markSessionDeleting(sessionId))) {
          return;
        }

        try {
          await this.runtimeManager.teardownSession(sessionId);
          await this.storage.deleteSession(sessionId);
          await this.metadata.deleteSession(sessionId);
        } catch (error) {
          await this.metadata.clearSessionDeleting(sessionId);
          throw error;
        }
      });
    }
  }
}
