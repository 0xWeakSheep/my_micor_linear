import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { migrations } from "./schema";

export type Database = DatabaseSync;
export type BindValue = SQLInputValue;

const globalDatabase = globalThis as typeof globalThis & {
  __orbitDatabase?: DatabaseSync;
};

function databasePath(): string {
  const configured = process.env.ORBIT_DB_PATH?.trim();
  return configured
    ? resolve(/* turbopackIgnore: true */ configured)
    : resolve(".data/orbit.db");
}

function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const exists = database.prepare(
    "SELECT 1 AS found FROM schema_migrations WHERE version = ?",
  );
  const record = database.prepare(
    "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of migrations) {
    if (exists.get(migration.version)) continue;

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function openDatabase(): DatabaseSync {
  const path = databasePath();
  const directory = dirname(path);
  if (directory === parse(directory).root) {
    throw new Error("ORBIT_DB_PATH must place the database inside a dedicated directory.");
  }
  process.umask(0o077);
  mkdirSync(/* turbopackIgnore: true */ directory, { recursive: true, mode: 0o700 });
  chmodSync(/* turbopackIgnore: true */ directory, 0o700);

  const database = new DatabaseSync(/* turbopackIgnore: true */ path, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  chmodSync(/* turbopackIgnore: true */ path, 0o600);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA temp_store = MEMORY");
  migrate(database);
  for (const databaseFile of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(/* turbopackIgnore: true */ databaseFile)) {
      chmodSync(/* turbopackIgnore: true */ databaseFile, 0o600);
    }
  }
  return database;
}

export function getDatabase(): DatabaseSync {
  globalDatabase.__orbitDatabase ??= openDatabase();
  return globalDatabase.__orbitDatabase;
}

export function closeDatabase(): void {
  globalDatabase.__orbitDatabase?.close();
  delete globalDatabase.__orbitDatabase;
}

export function getOne<T>(sql: string, ...parameters: BindValue[]): T | undefined {
  return getDatabase().prepare(sql).get(...parameters) as T | undefined;
}

export function getAll<T>(sql: string, ...parameters: BindValue[]): T[] {
  return getDatabase().prepare(sql).all(...parameters) as T[];
}

export function run(sql: string, ...parameters: BindValue[]): { changes: number; lastInsertRowid: number | bigint } {
  const result = getDatabase().prepare(sql).run(...parameters);
  return {
    changes: Number(result.changes),
    lastInsertRowid: result.lastInsertRowid,
  };
}

export function transaction<T>(operation: (database: DatabaseSync) => T): T {
  const database = getDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getDatabaseFilePath(): string {
  return databasePath();
}
