import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveWithin } from "../util/fs.js";

const SMALL_FILE_HASH_LIMIT_BYTES = 1024 * 1024;

export interface ManifestEntry {
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number;
  mtimeMs: number;
  hash?: string;
}

export type WorkspaceManifest = Map<string, ManifestEntry>;

export async function captureManifest(root: string, ignoredRelativePrefixes: string[] = [], options: { hashAllFiles?: boolean } = {}) {
  const manifest: WorkspaceManifest = new Map();
  await walk(root, "", manifest, ignoredRelativePrefixes.map(normalizePrefix), options.hashAllFiles ?? false);
  return manifest;
}

export function diffManifests(before: WorkspaceManifest, after: WorkspaceManifest) {
  const changedFiles: string[] = [];
  const deletedFiles: string[] = [];

  for (const [path, entry] of after.entries()) {
    if (entry.kind !== "file") {
      continue;
    }

    const previous = before.get(path);

    if (!previous || hasEntryChanged(previous, entry)) {
      changedFiles.push(path);
    }
  }

  for (const [path, entry] of before.entries()) {
    if (entry.kind !== "file") {
      continue;
    }

    if (!after.has(path)) {
      deletedFiles.push(path);
    }
  }

  changedFiles.sort();
  deletedFiles.sort();

  return { changedFiles, deletedFiles };
}

export function diffMetadataFiles(
  before: Array<{ path: string; size: number; checksum: string | null }>,
  after: WorkspaceManifest
) {
  const changedFiles: string[] = [];
  const deletedFiles: string[] = [];
  const beforeByPath = new Map(before.map((entry) => [entry.path, entry]));

  for (const [path, entry] of after.entries()) {
    if (entry.kind !== "file") {
      continue;
    }

    const previous = beforeByPath.get(path);
    if (!previous || previous.size !== entry.size || previous.checksum !== entry.hash) {
      changedFiles.push(path);
    }
  }

  for (const entry of before) {
    const current = after.get(entry.path);
    if (!current || current.kind !== "file") {
      deletedFiles.push(entry.path);
    }
  }

  changedFiles.sort();
  deletedFiles.sort();
  return { changedFiles, deletedFiles };
}

async function walk(
  root: string,
  relativeDir: string,
  manifest: WorkspaceManifest,
  ignoredRelativePrefixes: string[],
  hashAllFiles: boolean
) {
  const directoryPath = relativeDir ? resolveWithin(root, relativeDir) : root;
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
    const normalizedPath = entryRelativePath.replaceAll("\\", "/");

    if (shouldIgnore(normalizedPath, ignoredRelativePrefixes)) {
      continue;
    }

    const absolutePath = resolveWithin(root, normalizedPath);
    const stats = await lstat(absolutePath);
    const kind = toKind(entry, stats);

    manifest.set(normalizedPath, {
      path: normalizedPath,
      kind,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      hash:
        kind === "file" && (hashAllFiles || stats.size <= SMALL_FILE_HASH_LIMIT_BYTES)
          ? await hashFile(root, normalizedPath)
          : undefined
    });

    if (entry.isDirectory()) {
      await walk(root, normalizedPath, manifest, ignoredRelativePrefixes, hashAllFiles);
    }
  }
}

async function hashFile(root: string, relativePath: string) {
  const bytes = await readFile(resolveWithin(root, relativePath));
  return createHash("sha256").update(bytes).digest("hex");
}

function hasEntryChanged(before: ManifestEntry, after: ManifestEntry) {
  return (
    before.kind !== after.kind ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.hash !== after.hash
  );
}

function shouldIgnore(path: string, prefixes: string[]) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function normalizePrefix(prefix: string) {
  return prefix.replaceAll("\\", "/").replace(/\/+$/, "");
}

function toKind(
  entry: {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  },
  stats: Awaited<ReturnType<typeof lstat>>
): ManifestEntry["kind"] {
  if (entry.isFile()) {
    return "file";
  }

  if (entry.isDirectory()) {
    return "directory";
  }

  if (entry.isSymbolicLink()) {
    return "symlink";
  }

  return stats.isFile() ? "file" : "other";
}
