export class SessionLockManager {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(sessionId: string, work: () => Promise<T>) {
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(() => gate);

    this.tails.set(sessionId, current);
    await previous;

    try {
      return await work();
    } finally {
      release();

      if (this.tails.get(sessionId) === current) {
        this.tails.delete(sessionId);
      }
    }
  }
}
