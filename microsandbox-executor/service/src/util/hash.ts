import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function sha256File(path: string) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Buffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
