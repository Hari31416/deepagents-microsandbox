import { writeFile } from "node:fs/promises";
import { dirname, posix } from "node:path";

import { ensureDir, normalizeRelativePath, resolveWithin } from "../util/fs.js";

const INTERNAL_DIR = ".sandbox-executor";

export interface PreparedExecution {
  command: string;
  args: string[];
  ignoredRelativePrefixes: string[];
}

export async function preparePythonExecution(options: {
  workspacePath: string;
  entrypoint: string;
  code: string;
  enableRestrictedExec: boolean;
  blockedImports: string[];
}): Promise<PreparedExecution> {
  const entrypoint = normalizeRelativePath(options.entrypoint);
  const entrypointHostPath = resolveWithin(options.workspacePath, entrypoint);

  await ensureDir(dirname(entrypointHostPath));
  await writeFile(entrypointHostPath, options.code, "utf8");

  if (!options.enableRestrictedExec) {
    return {
      command: "python3",
      args: [entrypoint],
      ignoredRelativePrefixes: [INTERNAL_DIR]
    };
  }

  const runnerRelativePath = posix.join(INTERNAL_DIR, "runner.py");
  const runnerHostPath = resolveWithin(options.workspacePath, runnerRelativePath);

  await ensureDir(dirname(runnerHostPath));
  await writeFile(runnerHostPath, buildRunnerScript(entrypoint, options.blockedImports), "utf8");

  return {
    command: "python3",
    args: [runnerRelativePath],
    ignoredRelativePrefixes: [INTERNAL_DIR]
  };
}

export async function prepareBashExecution(options: {
  workspacePath: string;
  entrypoint: string;
  script: string;
}): Promise<PreparedExecution> {
  const entrypoint = normalizeRelativePath(options.entrypoint);
  const entrypointHostPath = resolveWithin(options.workspacePath, entrypoint);

  await ensureDir(dirname(entrypointHostPath));
  await writeFile(entrypointHostPath, options.script, "utf8");

  return {
    command: "bash",
    args: [entrypoint],
    ignoredRelativePrefixes: [INTERNAL_DIR]
  };
}

function buildRunnerScript(entrypoint: string, blockedImports: string[]) {
  const blockedLiteral = JSON.stringify([...new Set(blockedImports)].sort());
  const entrypointLiteral = JSON.stringify(entrypoint);

  return `import builtins
import pathlib

BLOCKED_IMPORTS = set(${blockedLiteral})
TARGET = pathlib.Path(${entrypointLiteral})

_real_import = builtins.__import__

def _restricted_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = name.split(".")[0]
    if root in BLOCKED_IMPORTS:
        raise ImportError(f"Import of '{root}' is blocked by the sandbox policy")
    return _real_import(name, globals, locals, fromlist, level)

builtins.__import__ = _restricted_import

globals_dict = {
    "__name__": "__main__",
    "__file__": str(TARGET),
}

source = TARGET.read_text(encoding="utf-8")
exec(compile(source, str(TARGET), "exec"), globals_dict, globals_dict)
`;
}
