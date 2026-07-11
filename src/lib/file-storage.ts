import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

function uploadRoot(): string {
  const configured = process.env.ORBIT_UPLOAD_DIR?.trim();
  if (configured) {
    // This path is intentionally supplied at runtime and must not be included in
    // Next.js output-file tracing during a production build.
    return resolve(/* turbopackIgnore: true */ configured);
  }
  return resolve(process.cwd(), ".data", "uploads");
}

function resolveStorageKey(storageKey: string): string {
  const root = uploadRoot();
  const target = resolve(/* turbopackIgnore: true */ root, storageKey);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid attachment storage key.");
  }
  return target;
}

export function attachmentStorageKey(workspaceId: string, fileId: string): string {
  return `${workspaceId}/${fileId}`;
}

export async function storeAttachment(storageKey: string, bytes: Uint8Array): Promise<void> {
  const target = resolveStorageKey(storageKey);
  await mkdir(/* turbopackIgnore: true */ dirname(target), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ target, bytes, { flag: "wx", mode: 0o600 });
}

export async function readAttachment(storageKey: string): Promise<Uint8Array> {
  return readFile(/* turbopackIgnore: true */ resolveStorageKey(storageKey));
}

export async function removeAttachment(storageKey: string): Promise<void> {
  await rm(/* turbopackIgnore: true */ resolveStorageKey(storageKey), { force: true });
}
