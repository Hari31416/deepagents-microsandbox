import type { AppConfig } from "../config.js";
import { MetadataStore } from "../metadata/store.js";
import { LocalSessionStorage } from "../storage/local.js";
import { SessionLockManager } from "./locks.js";

export class SessionCleanupService {
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly storage: LocalSessionStorage,
    private readonly metadata: MetadataStore,
    private readonly locks: SessionLockManager
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
    const expiredSessionIds = this.metadata.listExpiredSessionIds();

    for (const sessionId of expiredSessionIds) {
      await this.locks.runExclusive(sessionId, async () => {
        if (!this.metadata.markSessionDeleting(sessionId)) {
          return;
        }

        try {
          await this.storage.deleteSession(sessionId);
          this.metadata.deleteSession(sessionId);
        } catch (error) {
          this.metadata.clearSessionDeleting(sessionId);
          throw error;
        }
      });
    }
  }
}
