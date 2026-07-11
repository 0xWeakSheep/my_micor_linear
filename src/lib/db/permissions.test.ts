import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { closeDatabase, getDatabase } from ".";

let temporaryDirectory: string | null = null;

afterEach(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = null;
});

function permissions(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("SQLite storage permissions", () => {
  it("keeps its directory, database, WAL, and shared-memory files private", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "micro-linear-db-permissions-"));
    const directory = join(temporaryDirectory, "private-data");
    const databasePath = join(directory, "micro-linear.db");
    vi.stubEnv("MICRO_LINEAR_DB_PATH", databasePath);

    const database = getDatabase();
    database.exec("CREATE TABLE permission_probe(id TEXT PRIMARY KEY) STRICT");
    database.prepare("INSERT INTO permission_probe(id) VALUES (?)").run("probe");

    expect(permissions(directory)).toBe(0o700);
    expect(permissions(databasePath)).toBe(0o600);
    for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) {
      expect(existsSync(sidecar)).toBe(true);
      expect(permissions(sidecar)).toBe(0o600);
    }
  });
});
