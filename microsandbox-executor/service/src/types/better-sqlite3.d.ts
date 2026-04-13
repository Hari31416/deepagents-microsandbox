declare module "better-sqlite3" {
  export interface RunResult {
    changes: number;
  }

  export interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  }

  namespace Database {
    interface Database {
      exec(sql: string): this;
      pragma(value: string): unknown;
      prepare(sql: string): Statement;
      close(): void;
    }
  }

  class DatabaseImpl implements Database.Database {
    constructor(path: string);
    exec(sql: string): this;
    pragma(value: string): unknown;
    prepare(sql: string): Statement;
    close(): void;
  }

  export default DatabaseImpl;
}
