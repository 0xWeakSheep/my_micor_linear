import { closeDatabase, getDatabase, getDatabaseFilePath } from "../src/lib/db";

try {
  const database = getDatabase();
  const migrations = database
    .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
    .get() as { count: number };
  const integrity = database.prepare("PRAGMA quick_check").get() as { quick_check: string };
  if (integrity.quick_check !== "ok") {
    throw new Error(`SQLite quick_check returned ${integrity.quick_check}.`);
  }
  process.stdout.write(
    `${JSON.stringify({ database: getDatabaseFilePath(), migrations: Number(migrations.count), integrity: "ok" }, null, 2)}\n`,
  );
} finally {
  closeDatabase();
}
