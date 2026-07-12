import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { migrations } from "@/lib/db/schema";
import {
  checkDatabaseIntegrity,
  createBackupBundle,
  listBackupBundles,
  verifyBackupRestore,
} from "./sqlite-backup";

const temporaryDirectories: string[] = [];
const NOW = "2026-07-11T00:00:00.000Z";

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "micro-linear-backup-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function applySchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const insert = database.prepare(
    "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
  );
  for (const migration of migrations) {
    database.exec(migration.sql);
    insert.run(migration.version, migration.name, NOW);
  }
}

function fixture(): {
  root: string;
  databasePath: string;
  uploadDirectory: string;
  backupDirectory: string;
  attachmentPath: string;
} {
  const root = temporaryDirectory();
  const databasePath = join(root, "micro-linear.db");
  const uploadDirectory = join(root, "uploads");
  const backupDirectory = join(root, "backups");
  const attachmentPath = join(uploadDirectory, "workspace_1", "file_1");
  mkdirSync(join(uploadDirectory, "workspace_1"), { recursive: true });
  const bytes = Buffer.from("attachment-content", "utf8");
  writeFileSync(attachmentPath, bytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");

  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  database.exec("PRAGMA journal_mode = WAL");
  applySchema(database);
  database
    .prepare(
      `INSERT INTO users(id, name, email, created_at, updated_at)
       VALUES ('user_1', 'Alex', 'alex@example.com', ?, ?)`,
    )
    .run(NOW, NOW);
  database
    .prepare(
      `INSERT INTO workspaces(id, name, slug, icon, timezone, created_at, updated_at)
       VALUES ('workspace_1', 'Micro Linear', 'micro-linear', 'M', 'UTC', ?, ?)`,
    )
    .run(NOW, NOW);
  database
    .prepare(
      `INSERT INTO files(
        id, workspace_id, uploader_id, storage_key, name, url, size, mime,
        checksum, created_at
      ) VALUES (
        'file_1', 'workspace_1', 'user_1', 'workspace_1/file_1', 'report.txt',
        '/api/files/file_1', ?, 'text/plain', ?, ?
      )`,
    )
    .run(bytes.length, checksum, NOW);
  database.close();
  return { root, databasePath, uploadDirectory, backupDirectory, attachmentPath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite backup bundles", () => {
  it("backs up SQLite and referenced uploads, lists it, and verifies an isolated restore", async () => {
    const paths = fixture();
    const backup = await createBackupBundle({
      databasePath: paths.databasePath,
      uploadDirectory: paths.uploadDirectory,
      backupDirectory: paths.backupDirectory,
      now: new Date(NOW),
    });

    expect(backup.manifest.database).toMatchObject({
      integrityCheck: "ok",
      foreignKeyViolations: 0,
      tableCounts: { users: 1, workspaces: 1, files: 1 },
    });
    expect(backup.manifest.uploads).toMatchObject({ fileCount: 1, totalBytes: 18 });
    expect(existsSync(join(backup.bundlePath, "micro-linear.sqlite"))).toBe(true);
    expect(existsSync(join(backup.bundlePath, "uploads/workspace_1/file_1"))).toBe(true);
    expect(listBackupBundles(paths.backupDirectory)).toMatchObject([
      { path: backup.bundlePath, valid: true, uploadFileCount: 1 },
    ]);

    // Mutating production after the snapshot must not change the restore result.
    const production = new DatabaseSync(paths.databasePath);
    production
      .prepare(
        `INSERT INTO users(id, name, email, created_at, updated_at)
         VALUES ('user_2', 'Maya', 'maya@example.com', ?, ?)`,
      )
      .run(NOW, NOW);
    production.close();

    const verified = await verifyBackupRestore(backup.bundlePath);
    expect(verified).toMatchObject({
      ok: true,
      attachmentFilesVerified: 1,
      appliedMigrations: [],
      temporaryDirectory: null,
      database: { tableCounts: { users: 1, files: 1 } },
    });
    const source = new DatabaseSync(paths.databasePath, { readOnly: true });
    expect(source.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 2 });
    source.close();
  });

  it("refuses overwrite and detects upload tampering during restore verification", async () => {
    const paths = fixture();
    const destination = join(paths.backupDirectory, "known-backup");
    const backup = await createBackupBundle({
      databasePath: paths.databasePath,
      uploadDirectory: paths.uploadDirectory,
      destinationDirectory: destination,
      now: new Date(NOW),
    });
    await expect(
      createBackupBundle({
        databasePath: paths.databasePath,
        uploadDirectory: paths.uploadDirectory,
        destinationDirectory: destination,
      }),
    ).rejects.toThrow(/refusing to overwrite/i);

    appendFileSync(join(backup.bundlePath, "uploads/workspace_1/file_1"), "tampered");
    await expect(verifyBackupRestore(backup.bundlePath)).rejects.toThrow(
      /size does not match|size mismatch/i,
    );
    expect(checkDatabaseIntegrity(paths.databasePath)).toMatchObject({ ok: true });
  });

  it("marks a bundle invalid when its database file is missing", async () => {
    const paths = fixture();
    const backup = await createBackupBundle({
      databasePath: paths.databasePath,
      uploadDirectory: paths.uploadDirectory,
      backupDirectory: paths.backupDirectory,
      now: new Date(NOW),
    });
    rmSync(join(backup.bundlePath, "micro-linear.sqlite"));

    expect(listBackupBundles(paths.backupDirectory)).toMatchObject([
      {
        path: backup.bundlePath,
        valid: false,
        error: expect.stringMatching(/database is missing/i),
      },
    ]);
  });

  it("fails safely when a database-referenced upload is missing", async () => {
    const paths = fixture();
    const descriptor = openSync(paths.attachmentPath, "r");
    closeSync(descriptor);
    rmSync(paths.attachmentPath);
    await expect(
      createBackupBundle({
        databasePath: paths.databasePath,
        uploadDirectory: paths.uploadDirectory,
        backupDirectory: paths.backupDirectory,
      }),
    ).rejects.toThrow(/referenced attachment is missing/i);
    expect(listBackupBundles(paths.backupDirectory)).toEqual([]);
  });

  it("rejects a migration-only database without required application tables", () => {
    const root = temporaryDirectory();
    const databasePath = join(root, "empty-shell.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const insert = database.prepare(
      "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
    );
    for (const migration of migrations) {
      insert.run(migration.version, migration.name, NOW);
    }
    database.close();

    expect(checkDatabaseIntegrity(databasePath)).toMatchObject({
      ok: false,
      migrations: migrations.map(({ version, name }) => ({ version, name })),
      tableCounts: {},
    });
  });

  it("continues to verify backup bundles created before the brand migration", async () => {
    const paths = fixture();
    const backup = await createBackupBundle({
      databasePath: paths.databasePath,
      uploadDirectory: paths.uploadDirectory,
      backupDirectory: paths.backupDirectory,
      now: new Date(NOW),
    });
    const manifestPath = join(backup.bundlePath, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      format: string;
      database: { file: string };
    };
    renameSync(
      join(backup.bundlePath, "micro-linear.sqlite"),
      join(backup.bundlePath, "orbit.sqlite"),
    );
    manifest.format = "orbit-backup";
    manifest.database.file = "orbit.sqlite";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(verifyBackupRestore(backup.bundlePath)).resolves.toMatchObject({
      ok: true,
      attachmentFilesVerified: 1,
    });
  });
});
