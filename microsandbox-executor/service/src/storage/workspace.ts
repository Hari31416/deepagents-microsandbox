import { join } from "node:path";

import { ensureDir, listDirectoryNames, removeDirIfExists } from "../util/fs.js";

export interface JobWorkspace {
  jobRoot: string;
  workspacePath: string;
}

export interface SessionWorkspace {
  sessionRoot: string;
  workspacePath: string;
}

export async function createJobWorkspace(scratchRoot: string, sessionId: string, jobId: string): Promise<JobWorkspace> {
  const jobRoot = join(scratchRoot, sessionId, jobId);
  const workspacePath = join(jobRoot, "workspace");

  await ensureDir(workspacePath);

  return {
    jobRoot,
    workspacePath
  };
}

export async function cleanupJobWorkspace(jobRoot: string) {
  await removeDirIfExists(jobRoot);
}

export function resolveSessionWorkspacePaths(scratchRoot: string, sessionId: string): SessionWorkspace {
  const sessionRoot = join(scratchRoot, "sessions", sessionId);
  return {
    sessionRoot,
    workspacePath: join(sessionRoot, "workspace")
  };
}

export async function createSessionWorkspace(scratchRoot: string, sessionId: string): Promise<SessionWorkspace> {
  const workspace = resolveSessionWorkspacePaths(scratchRoot, sessionId);
  await ensureDir(workspace.workspacePath);
  return workspace;
}

export async function cleanupSessionWorkspace(sessionRoot: string) {
  await removeDirIfExists(sessionRoot);
}

export async function listSessionWorkspaceIds(scratchRoot: string) {
  return listDirectoryNames(join(scratchRoot, "sessions"));
}
