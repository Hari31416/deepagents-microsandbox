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

export async function captureManifest(root: string, ignoredRelativePrefixes: string[] = []) {
  const manifest: WorkspaceManifest = new Map();
  await walk(root, "", manifest, ignoredRelativePrefixes.map(normalizePrefix));
  return manifest;
}

export function diffManifests(before: WorkspaceManifest, after: WorkspaceManifest) {
  const changedFiles: string[] = [];

  for (const [path, entry] of after.entries()) {
    if (entry.kind !== "file") {
      continue;
    }

    const previous = before.get(path);

    if (!previous || hasEntryChanged(previous, entry)) {
      changedFiles.push(path);
    }
  }

  changedFiles.sort();

  return { changedFiles };
}

async function walk(
  root: string,
  relativeDir: string,
  manifest: WorkspaceManifest,
  ignoredRelativePrefixes: string[]
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
      hash: kind === "file" && stats.size <= SMALL_FILE_HASH_LIMIT_BYTES ? await hashFile(root, normalizedPath) : undefined
    });

    if (entry.isDirectory()) {
      await walk(root, normalizedPath, manifest, ignoredRelativePrefixes);
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
