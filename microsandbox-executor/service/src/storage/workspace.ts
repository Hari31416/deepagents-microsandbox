import { join } from "node:path";

import { ensureDir, removeDirIfExists } from "../util/fs.js";

export interface JobWorkspace {
  jobRoot: string;
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
