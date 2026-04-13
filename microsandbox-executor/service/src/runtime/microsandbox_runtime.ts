import { Mount, Sandbox, isInstalled } from "microsandbox";

import { buildNetworkConfig } from "../policy/network.js";
import type { SandboxRuntime, RuntimeHealth, RuntimeJobInput, RuntimeJobResult } from "./types.js";

export class MicrosandboxRuntime implements SandboxRuntime {
  async executeJob(input: RuntimeJobInput): Promise<RuntimeJobResult> {
    if (!isInstalled()) {
      throw new Error("microsandbox runtime is not installed. Install it before executing jobs.");
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
        PYTHONUNBUFFERED: "1",
        ...input.environment
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
    } finally {
      console.info("[microsandbox] cleaning sandbox", {
        timestamp: new Date().toISOString(),
        sandboxName: input.sandboxName
      });
      await this.cleanupSandbox(sandbox, input.sandboxName);
    }
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
