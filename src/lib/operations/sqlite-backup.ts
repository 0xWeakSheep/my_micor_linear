import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { migrations } from "@/lib/db/schema";
import { preferredEnvironmentValue } from "@/lib/runtime-config";

const BACKUP_FORMAT = "micro-linear-backup";
const LEGACY_BACKUP_FORMAT = "orbit-backup";
const BACKUP_VERSION = 1;
const DATABASE_FILE = "micro-linear.sqlite";
const LEGACY_DATABASE_FILE = "orbit.sqlite";
const UPLOAD_DIRECTORY = "uploads";
const MANIFEST_FILE = "manifest.json";
const CORE_TABLES = [
  "users",
  "workspaces",
  "workspace_members",
  "teams",
  "issues",
  "projects",
  "cycles",
  "files",
  "notifications",
  "outbox_events",
] as const;

const migrationSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().min(1),
});

const backupFileSchema = z.object({
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  databaseChecksum: z.string().nullable(),
});

const manifestSchema = z.object({
  format: z.enum([BACKUP_FORMAT, LEGACY_BACKUP_FORMAT]),
  version: z.literal(BACKUP_VERSION),
  createdAt: z.string().datetime(),
  database: z.object({
    file: z.enum([DATABASE_FILE, LEGACY_DATABASE_FILE]),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    integrityCheck: z.literal("ok"),
    foreignKeyViolations: z.literal(0),
    migrations: z.array(migrationSchema),
    tableCounts: z.record(z.string(), z.number().int().nonnegative()),
  }),
  uploads: z.object({
    directory: z.literal(UPLOAD_DIRECTORY),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    files: z.array(backupFileSchema),
  }),
  source: z.object({
    databaseFilename: z.string().min(1),
    uploadDirectoryName: z.string().min(1),
  }),
});

export type BackupManifest = z.infer<typeof manifestSchema>;
export type BackupFileManifest = z.infer<typeof backupFileSchema>;

export interface DatabaseIntegrityResult {
  path: string;
  ok: boolean;
  integrityCheck: string[];
  foreignKeyViolations: number;
  migrations: Array<{ version: number; name: string }>;
  tableCounts: Record<string, number>;
}

export interface CreateBackupOptions {
  databasePath: string;
  uploadDirectory: string;
  backupDirectory?: string;
  destinationDirectory?: string;
  now?: Date;
}

export interface CreateBackupResult {
  bundlePath: string;
  manifest: BackupManifest;
}

export interface BackupListEntry {
  path: string;
  name: string;
  valid: boolean;
  createdAt: string | null;
  databaseSizeBytes: number | null;
  uploadFileCount: number | null;
  error?: string;
}

export interface RestoreVerificationResult {
  backupPath: string;
  ok: true;
  database: DatabaseIntegrityResult;
  attachmentFilesVerified: number;
  appliedMigrations: number[];
  temporaryDirectory: string | null;
}

interface AttachmentReference {
  storageKey: string;
  size: number;
  checksum: string | null;
}

function latestMigrationVersion(): number {
  return migrations.at(-1)?.version ?? 0;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function assertRegularFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
}

function assertResolvedWithin(root: string, target: string, label: string): void {
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  if (!isWithin(realRoot, realTarget) || realTarget === realRoot) {
    throw new Error(`${label} resolves outside its root.`);
  }
}

function safeStoragePath(root: string, storageKey: string): string {
  if (
    !storageKey ||
    storageKey.includes("\\") ||
    isAbsolute(storageKey) ||
    storageKey.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe attachment storage key: ${storageKey}`);
  }
  const target = resolve(root, storageKey);
  if (!isWithin(root, target) || target === resolve(root)) {
    throw new Error(`Attachment storage key leaves its root: ${storageKey}`);
  }
  return target;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function readMigrations(database: DatabaseSync): Array<{ version: number; name: string }> {
  const table = database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!table) throw new Error("Database does not contain Micro Linear schema migrations.");
  return (
    database
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number; name: string }>
  ).map((row) => ({ version: Number(row.version), name: String(row.name) }));
}

function tableCounts(database: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  const exists = database.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  );
  for (const table of CORE_TABLES) {
    if (!exists.get(table)) continue;
    const row = database
      .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`)
      .get() as { count: number | bigint };
    counts[table] = Number(row.count);
  }
  return counts;
}

function hasValidMigrationHistory(
  applied: Array<{ version: number; name: string }>,
): boolean {
  return applied.length > 0 && applied.every((migration, index) => {
    const expected = migrations[index];
    return expected?.version === migration.version && expected.name === migration.name;
  });
}

function inspectOpenDatabase(database: DatabaseSync, path: string): DatabaseIntegrityResult {
  const integrityCheck = (
    database.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>
  ).map((row) => String(row.integrity_check));
  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all().length;
  const applied = readMigrations(database);
  const counts = tableCounts(database);
  const ok =
    integrityCheck.length === 1 &&
    integrityCheck[0] === "ok" &&
    foreignKeyViolations === 0 &&
    hasValidMigrationHistory(applied) &&
    CORE_TABLES.every((table) => Object.hasOwn(counts, table));
  return {
    path: resolve(path),
    ok,
    integrityCheck,
    foreignKeyViolations,
    migrations: applied,
    tableCounts: counts,
  };
}

export function checkDatabaseIntegrity(databasePath: string): DatabaseIntegrityResult {
  const path = resolve(databasePath);
  if (!existsSync(path)) throw new Error(`Database does not exist: ${path}`);
  assertRegularFile(path, "Database");
  const database = new DatabaseSync(path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    timeout: 10_000,
  });
  try {
    return inspectOpenDatabase(database, path);
  } finally {
    database.close();
  }
}

function attachmentReferences(database: DatabaseSync): AttachmentReference[] {
  const table = database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'files'")
    .get();
  if (!table) return [];
  return (
    database
      .prepare(
        `SELECT storage_key AS storageKey, size, checksum
           FROM files ORDER BY storage_key`,
      )
      .all() as unknown as AttachmentReference[]
  ).map((row) => ({
    storageKey: String(row.storageKey),
    size: Number(row.size),
    checksum: row.checksum === null ? null : String(row.checksum),
  }));
}

function writeJsonDurably(path: string, value: unknown): void {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function backupName(now: Date): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `micro-linear-backup-${timestamp}-${randomBytes(4).toString("hex")}`;
}

async function copyReferencedUploads(
  references: AttachmentReference[],
  sourceRoot: string,
  destinationRoot: string,
): Promise<BackupFileManifest[]> {
  mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  const files: BackupFileManifest[] = [];
  for (const reference of references) {
    const source = safeStoragePath(sourceRoot, reference.storageKey);
    if (!existsSync(source)) {
      throw new Error(`Referenced attachment is missing: ${reference.storageKey}`);
    }
    assertRegularFile(source, "Attachment");
    assertResolvedWithin(sourceRoot, source, `Attachment ${reference.storageKey}`);
    const sourceStat = statSync(source);
    if (sourceStat.size !== reference.size) {
      throw new Error(
        `Attachment size mismatch for ${reference.storageKey}: database=${reference.size}, disk=${sourceStat.size}`,
      );
    }
    const target = safeStoragePath(destinationRoot, reference.storageKey);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(source, target);
    const sha256 = await sha256File(target);
    if (reference.checksum && reference.checksum !== sha256) {
      throw new Error(`Attachment checksum mismatch: ${reference.storageKey}`);
    }
    files.push({
      path: reference.storageKey,
      sizeBytes: sourceStat.size,
      sha256,
      databaseChecksum: reference.checksum,
    });
  }
  return files;
}

export async function createBackupBundle(
  options: CreateBackupOptions,
): Promise<CreateBackupResult> {
  const now = options.now ?? new Date();
  const databasePath = resolve(options.databasePath);
  const uploadDirectory = resolve(options.uploadDirectory);
  if (!existsSync(databasePath)) throw new Error(`Database does not exist: ${databasePath}`);
  assertRegularFile(databasePath, "Database");

  const defaultBackupRoot = resolve(options.backupDirectory ?? ".data/backups");
  const finalPath = options.destinationDirectory
    ? resolve(options.destinationDirectory)
    : join(defaultBackupRoot, backupName(now));
  const parent = dirname(finalPath);
  if (finalPath === databasePath || isWithin(uploadDirectory, finalPath)) {
    throw new Error("Backup destination must be outside the database and uploads directory.");
  }
  if (existsSync(finalPath)) {
    throw new Error(`Backup destination already exists; refusing to overwrite it: ${finalPath}`);
  }
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (existsSync(uploadDirectory)) {
    const physicalDestination = join(realpathSync(parent), basename(finalPath));
    if (isWithin(realpathSync(uploadDirectory), physicalDestination)) {
      throw new Error("Backup destination physically resolves inside the uploads directory.");
    }
  }
  const stagingPath = join(parent, `.${basename(finalPath)}.${randomBytes(4).toString("hex")}.tmp`);
  mkdirSync(stagingPath, { mode: 0o700 });

  const snapshotPath = join(stagingPath, DATABASE_FILE);
  try {
    const source = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      timeout: 10_000,
    });
    try {
      source.exec("PRAGMA busy_timeout = 10000");
      const quickCheck = (
        source.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>
      ).map((row) => String(row.quick_check));
      if (quickCheck.length !== 1 || quickCheck[0] !== "ok") {
        throw new Error(`Source SQLite quick_check failed: ${quickCheck.join("; ")}`);
      }
      source.prepare("VACUUM INTO ?").run(snapshotPath);
    } finally {
      source.close();
    }
    assertRegularFile(snapshotPath, "Database snapshot");

    const snapshot = new DatabaseSync(snapshotPath, {
      readOnly: true,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    });
    let integrity: DatabaseIntegrityResult;
    let references: AttachmentReference[];
    try {
      integrity = inspectOpenDatabase(snapshot, snapshotPath);
      references = attachmentReferences(snapshot);
    } finally {
      snapshot.close();
    }
    if (!integrity.ok) {
      throw new Error(
        `Backup database failed verification: ${integrity.integrityCheck.join("; ")}`,
      );
    }

    const uploadFiles = await copyReferencedUploads(
      references,
      uploadDirectory,
      join(stagingPath, UPLOAD_DIRECTORY),
    );
    const snapshotStat = statSync(snapshotPath);
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: now.toISOString(),
      database: {
        file: DATABASE_FILE,
        sizeBytes: snapshotStat.size,
        sha256: await sha256File(snapshotPath),
        integrityCheck: "ok",
        foreignKeyViolations: 0,
        migrations: integrity.migrations,
        tableCounts: integrity.tableCounts,
      },
      uploads: {
        directory: UPLOAD_DIRECTORY,
        fileCount: uploadFiles.length,
        totalBytes: uploadFiles.reduce((total, file) => total + file.sizeBytes, 0),
        files: uploadFiles,
      },
      source: {
        databaseFilename: basename(databasePath),
        uploadDirectoryName: basename(uploadDirectory),
      },
    };
    writeJsonDurably(join(stagingPath, MANIFEST_FILE), manifest);
    renameSync(stagingPath, finalPath);
    return { bundlePath: finalPath, manifest };
  } catch (error) {
    rmSync(stagingPath, { force: true, recursive: true });
    throw error;
  }
}

function parseManifest(bundlePath: string): BackupManifest {
  const manifestPath = join(bundlePath, MANIFEST_FILE);
  if (!existsSync(manifestPath)) throw new Error(`Backup manifest is missing: ${manifestPath}`);
  assertRegularFile(manifestPath, "Backup manifest");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(`Backup manifest is not valid JSON: ${manifestPath}`);
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Backup manifest is invalid: ${result.error.issues[0]?.message}`);
  }
  return result.data;
}

export function listBackupBundles(backupDirectory: string): BackupListEntry[] {
  const root = resolve(backupDirectory);
  if (!existsSync(root)) return [];
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Backup root must be a directory: ${root}`);
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry): BackupListEntry => {
      const path = join(root, entry.name);
      try {
        const manifest = parseManifest(path);
        const databasePath = resolve(path, manifest.database.file);
        if (!isWithin(path, databasePath) || !existsSync(databasePath)) {
          throw new Error("Backup database is missing or leaves its bundle.");
        }
        assertRegularFile(databasePath, "Backup database");
        if (statSync(databasePath).size !== manifest.database.sizeBytes) {
          throw new Error("Backup database size does not match its manifest.");
        }
        const uploadRoot = resolve(path, manifest.uploads.directory);
        if (!isWithin(path, uploadRoot)) throw new Error("Backup uploads path leaves its bundle.");
        if (manifest.uploads.fileCount > 0 && !existsSync(uploadRoot)) {
          throw new Error("Backup uploads directory is missing.");
        }
        for (const file of manifest.uploads.files) {
          const uploadPath = safeStoragePath(uploadRoot, file.path);
          if (!existsSync(uploadPath)) throw new Error(`Backup upload is missing: ${file.path}`);
          assertRegularFile(uploadPath, "Backup upload");
          if (statSync(uploadPath).size !== file.sizeBytes) {
            throw new Error(`Backup upload size does not match: ${file.path}`);
          }
        }
        return {
          path,
          name: entry.name,
          valid: true,
          createdAt: manifest.createdAt,
          databaseSizeBytes: manifest.database.sizeBytes,
          uploadFileCount: manifest.uploads.fileCount,
        };
      } catch (error) {
        return {
          path,
          name: entry.name,
          valid: false,
          createdAt: null,
          databaseSizeBytes: null,
          uploadFileCount: null,
          error: error instanceof Error ? error.message : "Invalid backup bundle.",
        };
      }
    })
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
}

function applyMissingMigrations(database: DatabaseSync): number[] {
  const appliedRows = readMigrations(database);
  if (!hasValidMigrationHistory(appliedRows)) {
    throw new Error("Backup migration history does not match this application.");
  }
  const applied = new Set(appliedRows.map((migration) => migration.version));
  const future = appliedRows.filter((migration) => migration.version > latestMigrationVersion());
  if (future.length) {
    throw new Error(
      `Backup schema is newer than this application: migration ${future[0]!.version}.`,
    );
  }
  const installed: number[] = [];
  const insert = database.prepare(
    "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      insert.run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT");
      installed.push(migration.version);
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  return installed;
}

async function copyAndVerifyManifestUploads(
  manifest: BackupManifest,
  bundleRoot: string,
  temporaryUploadRoot: string,
): Promise<void> {
  const sourceRoot = resolve(bundleRoot, manifest.uploads.directory);
  if (!isWithin(bundleRoot, sourceRoot)) throw new Error("Backup uploads path leaves its bundle.");
  if (!existsSync(sourceRoot)) {
    if (manifest.uploads.fileCount > 0) throw new Error("Backup uploads directory is missing.");
  } else {
    const sourceRootStat = lstatSync(sourceRoot);
    if (sourceRootStat.isSymbolicLink() || !sourceRootStat.isDirectory()) {
      throw new Error("Backup uploads path must be a real directory.");
    }
  }
  mkdirSync(temporaryUploadRoot, { recursive: true, mode: 0o700 });
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of manifest.uploads.files) {
    if (seen.has(file.path)) throw new Error(`Duplicate upload in manifest: ${file.path}`);
    seen.add(file.path);
    const source = safeStoragePath(sourceRoot, file.path);
    if (!existsSync(source)) throw new Error(`Backup upload is missing: ${file.path}`);
    assertRegularFile(source, "Backup upload");
    assertResolvedWithin(sourceRoot, source, `Backup upload ${file.path}`);
    const sourceStat = statSync(source);
    if (sourceStat.size !== file.sizeBytes) {
      throw new Error(`Backup upload size mismatch: ${file.path}`);
    }
    if ((await sha256File(source)) !== file.sha256) {
      throw new Error(`Backup upload checksum mismatch: ${file.path}`);
    }
    const target = safeStoragePath(temporaryUploadRoot, file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    copyFileSync(source, target);
    if ((await sha256File(target)) !== file.sha256) {
      throw new Error(`Restored upload checksum mismatch: ${file.path}`);
    }
    totalBytes += sourceStat.size;
  }
  if (seen.size !== manifest.uploads.fileCount || totalBytes !== manifest.uploads.totalBytes) {
    throw new Error("Backup upload manifest totals do not match its files.");
  }
}

async function verifyAttachmentReferences(
  database: DatabaseSync,
  uploadRoot: string,
): Promise<number> {
  const references = attachmentReferences(database);
  for (const reference of references) {
    const path = safeStoragePath(uploadRoot, reference.storageKey);
    if (!existsSync(path)) {
      throw new Error(`Restored attachment is missing: ${reference.storageKey}`);
    }
    assertRegularFile(path, "Restored attachment");
    const stat = statSync(path);
    if (stat.size !== reference.size) {
      throw new Error(`Restored attachment size mismatch: ${reference.storageKey}`);
    }
    if (reference.checksum && (await sha256File(path)) !== reference.checksum) {
      throw new Error(`Restored attachment checksum mismatch: ${reference.storageKey}`);
    }
  }
  return references.length;
}

export async function verifyBackupRestore(
  backupPath: string,
  options: { keepTemporary?: boolean } = {},
): Promise<RestoreVerificationResult> {
  const bundlePath = resolve(backupPath);
  if (!existsSync(bundlePath)) throw new Error(`Backup bundle does not exist: ${bundlePath}`);
  const bundleStat = lstatSync(bundlePath);
  if (bundleStat.isSymbolicLink() || !bundleStat.isDirectory()) {
    throw new Error(`Backup bundle must be a directory: ${bundlePath}`);
  }
  const manifest = parseManifest(bundlePath);
  const sourceDatabase = resolve(bundlePath, manifest.database.file);
  if (!isWithin(bundlePath, sourceDatabase) || !existsSync(sourceDatabase)) {
    throw new Error("Backup database is missing or leaves its bundle.");
  }
  assertRegularFile(sourceDatabase, "Backup database");
  if (statSync(sourceDatabase).size !== manifest.database.sizeBytes) {
    throw new Error("Backup database size does not match its manifest.");
  }
  if ((await sha256File(sourceDatabase)) !== manifest.database.sha256) {
    throw new Error("Backup database checksum does not match its manifest.");
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "micro-linear-restore-verify-"));
  const temporaryDatabase = join(temporaryDirectory, DATABASE_FILE);
  const temporaryUploads = join(temporaryDirectory, UPLOAD_DIRECTORY);
  let succeeded = false;
  try {
    copyFileSync(sourceDatabase, temporaryDatabase);
    if ((await sha256File(temporaryDatabase)) !== manifest.database.sha256) {
      throw new Error("Temporary database copy failed checksum verification.");
    }
    await copyAndVerifyManifestUploads(
      manifest,
      bundlePath,
      temporaryUploads,
    );

    const database = new DatabaseSync(temporaryDatabase, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      timeout: 10_000,
    });
    let integrity: DatabaseIntegrityResult;
    let appliedMigrations: number[];
    let attachmentFilesVerified: number;
    try {
      const before = inspectOpenDatabase(database, temporaryDatabase);
      if (!before.ok) throw new Error("Temporary restore failed its initial integrity check.");
      appliedMigrations = applyMissingMigrations(database);
      integrity = inspectOpenDatabase(database, temporaryDatabase);
      if (!integrity.ok) throw new Error("Temporary restore failed integrity after migrations.");
      attachmentFilesVerified = await verifyAttachmentReferences(database, temporaryUploads);
    } finally {
      database.close();
    }
    succeeded = true;
    return {
      backupPath: bundlePath,
      ok: true,
      database: integrity,
      attachmentFilesVerified,
      appliedMigrations,
      temporaryDirectory: options.keepTemporary ? temporaryDirectory : null,
    };
  } finally {
    if (!options.keepTemporary || !succeeded) {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  }
}

export function defaultDatabasePath(): string {
  const configured = preferredEnvironmentValue(
    process.env.MICRO_LINEAR_DB_PATH,
    process.env.ORBIT_DB_PATH,
  );
  if (configured) return resolve(configured);
  const currentDefault = resolve(".data/micro-linear.db");
  const legacyDefault = resolve(".data/orbit.db");
  return existsSync(currentDefault) || !existsSync(legacyDefault)
    ? currentDefault
    : legacyDefault;
}

export function defaultUploadDirectory(): string {
  return resolve(
    preferredEnvironmentValue(
      process.env.MICRO_LINEAR_UPLOAD_DIR,
      process.env.ORBIT_UPLOAD_DIR,
    ) || ".data/uploads",
  );
}

export function defaultBackupDirectory(): string {
  return resolve(
    preferredEnvironmentValue(
      process.env.MICRO_LINEAR_BACKUP_DIR,
      process.env.ORBIT_BACKUP_DIR,
    ) || ".data/backups",
  );
}
