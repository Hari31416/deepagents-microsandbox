import { Mount, Sandbox, isInstalled } from "microsandbox";

import { buildNetworkConfig } from "../policy/network.js";
import type {
  RuntimeExecInput,
  RuntimeHealth,
  RuntimeJobResult,
  RuntimeLeaseHandle,
  SandboxRuntime,
  SessionRuntimeSpec
} from "./types.js";

export class MicrosandboxRuntime implements SandboxRuntime {
  private readonly sandboxes = new Map<string, Sandbox>();

  async ensureSandbox(input: SessionRuntimeSpec): Promise<RuntimeLeaseHandle> {
    if (!isInstalled()) {
      throw new Error("microsandbox runtime is not installed. Install it before executing jobs.");
    }

    const cachedSandbox = this.sandboxes.get(input.sandboxName);
    if (cachedSandbox) {
      return { sandboxName: input.sandboxName };
    }

    const existing = (await Sandbox.list()).find((sandbox) => sandbox.name === input.sandboxName);
    if (existing?.status === "running") {
      const sandbox = await (await Sandbox.get(input.sandboxName)).connect();
      this.sandboxes.set(input.sandboxName, sandbox);
      return { sandboxName: input.sandboxName };
    }

    if (existing) {
      await this.destroySandbox(input.sandboxName);
    }

    console.info("[microsandbox] creating sandbox", {
      timestamp: new Date().toISOString(),
      sandboxName: input.sandboxName,
      image: input.image,
      workspaceHostPath: input.workspaceHostPath,
      guestWorkspacePath: input.guestWorkspacePath,
      cpuLimit: input.cpuLimit,
      memoryMb: input.memoryMb,
      networkMode: input.networkMode
    });
    const createStartedAt = Date.now();
    const sandbox = await Sandbox.create({
      name: input.sandboxName,
      image: input.image,
      cpus: input.cpuLimit,
      memoryMib: input.memoryMb,
      workdir: input.guestWorkspacePath,
      replace: true,
      env: {
        PYTHONUNBUFFERED: "1"
      },
      volumes: {
        [input.guestWorkspacePath]: Mount.bind(input.workspaceHostPath)
      },
      network: buildNetworkConfig(input.networkMode, input.allowedHosts)
    });
    console.info("[microsandbox] sandbox ready", {
      timestamp: new Date().toISOString(),
      sandboxName: input.sandboxName,
      image: input.image,
      createDurationMs: Date.now() - createStartedAt
    });

    this.sandboxes.set(input.sandboxName, sandbox);
    return { sandboxName: input.sandboxName };
  }

  async execInSandbox(input: RuntimeExecInput): Promise<RuntimeJobResult> {
    const sandbox = this.sandboxes.get(input.sandboxName);
    if (!sandbox) {
      throw new Error(`Sandbox not ready: ${input.sandboxName}`);
    }

    const startedAt = Date.now();

    try {
      console.info("[microsandbox] starting command", {
        timestamp: new Date().toISOString(),
        sandboxName: input.sandboxName,
        command: input.command,
        args: input.args,
        timeoutMs: input.timeoutMs
      });
      const output = await sandbox.execWithConfig({
        cmd: input.command,
        args: input.args,
        cwd: input.guestWorkspacePath,
        env: input.environment,
        timeoutMs: input.timeoutMs
      });

      console.info("[microsandbox] command finished", {
        timestamp: new Date().toISOString(),
        sandboxName: input.sandboxName,
        exitCode: output.code,
        durationMs: Date.now() - startedAt
      });

      return {
        exitCode: output.code,
        stdout: output.stdout(),
        stderr: output.stderr(),
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      console.error("[microsandbox] command failed", {
        timestamp: new Date().toISOString(),
        sandboxName: input.sandboxName,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      throw error;
    }
  }

  async destroySandbox(sandboxName: string) {
    const sandbox = this.sandboxes.get(sandboxName);
    if (sandbox) {
      await this.cleanupSandbox(sandbox, sandboxName);
      this.sandboxes.delete(sandboxName);
      return;
    }

    try {
      const existing = (await Sandbox.list()).find((entry) => entry.name === sandboxName);
      if (!existing) {
        return;
      }

      const handle = await Sandbox.get(sandboxName);
      try {
        await handle.stop();
      } catch {
        try {
          await handle.kill();
        } catch {
          // Ignore runtime cleanup failures while reaping stale sandboxes.
        }
      }
      await handle.remove();
    } catch {
      try {
        await Sandbox.remove(sandboxName);
      } catch {
        // Ignore missing records.
      }
    }
  }

  async destroyAllSandboxes() {
    for (const sandboxName of await this.listSandboxes()) {
      await this.destroySandbox(sandboxName);
    }
  }

  async listSandboxes() {
    if (!isInstalled()) {
      return [];
    }

    return (await Sandbox.list()).map((sandbox) => sandbox.name);
  }

  async healthCheck(): Promise<RuntimeHealth> {
    if (!isInstalled()) {
      return {
        ok: false,
        runtime: "microsandbox",
        details: "microsandbox is not installed on this machine"
      };
    }

    try {
      await Sandbox.list();
      return {
        ok: true,
        runtime: "microsandbox",
        details: "runtime available"
      };
    } catch (error) {
      return {
        ok: false,
        runtime: "microsandbox",
        details: error instanceof Error ? error.message : "failed to query runtime"
      };
    }
  }

  private async cleanupSandbox(sandbox: Sandbox, sandboxName: string) {
    try {
      await sandbox.stopAndWait();
    } catch {
      try {
        await sandbox.kill();
      } catch {
        // Ignore cleanup failures and try to remove the persisted record.
      }
    }

    try {
      await Sandbox.remove(sandboxName);
    } catch {
      // Ignore missing or already-removed sandbox records.
    }

    console.info("[microsandbox] sandbox cleaned", {
      timestamp: new Date().toISOString(),
      sandboxName
    });
  }
}
