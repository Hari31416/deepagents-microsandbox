import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { dirname, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

export async function removeDirIfExists(path: string) {
  await rm(path, { recursive: true, force: true });
}

export async function removeFileIfExists(path: string) {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function normalizeRelativePath(value: string) {
  const normalized = normalize(value).replaceAll("\\", "/");

  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path must stay inside the workspace: ${value}`);
  }

  return normalized;
}

export function resolveWithin(root: string, relativePath: string) {
  const safeRelativePath = normalizeRelativePath(relativePath);
  const resolved = resolve(root, safeRelativePath);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;

  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Resolved path escaped workspace root: ${relativePath}`);
  }

  return resolved;
}

export async function writeStreamToFile(stream: NodeJS.ReadableStream, destinationPath: string) {
  await ensureDir(dirname(destinationPath));
  await pipeline(stream, createWriteStream(destinationPath));
}

export async function copyRelativeFile(sourceRoot: string, destinationRoot: string, relativePath: string) {
  const sourcePath = resolveWithin(sourceRoot, relativePath);
  const destinationPath = resolveWithin(destinationRoot, relativePath);

  await ensureDir(dirname(destinationPath));
  await copyFile(sourcePath, destinationPath);
}

export async function statWithin(root: string, relativePath: string) {
  return stat(resolveWithin(root, relativePath));
}

export async function listDirectoryNames(path: string) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}
