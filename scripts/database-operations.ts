import {
  checkDatabaseIntegrity,
  createBackupBundle,
  defaultBackupDirectory,
  defaultDatabasePath,
  defaultUploadDirectory,
  listBackupBundles,
  verifyBackupRestore,
} from "../src/lib/operations/sqlite-backup";

type Command = "backup" | "integrity" | "list" | "verify";

interface Arguments {
  command: Command;
  databasePath: string;
  uploadDirectory: string;
  backupDirectory: string;
  destinationDirectory?: string;
  backupPath?: string;
  keepTemporary: boolean;
}

function usage(): string {
  return `Micro Linear database and upload backup operations.

Usage:
  npm run db:backup -- [--destination <new-directory>]
  npm run db:integrity
  npm run db:backups
  npm run db:restore-verify -- --backup <backup-directory>

Common options:
  --database <path>       SQLite database (default MICRO_LINEAR_DB_PATH)
  --uploads <path>        Attachment root (default MICRO_LINEAR_UPLOAD_DIR)
  --backup-dir <path>     Backup root (default MICRO_LINEAR_BACKUP_DIR)
  --help                  Show this message

Backup options:
  --destination <path>    Exact new bundle directory; it must not exist

Verify options:
  --backup <path>         Bundle to restore into an isolated temporary directory
  --keep-temporary        Keep a successful temporary restore for inspection
`;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path.`);
  return value;
}

function parseArguments(arguments_: string[]): Arguments | "help" {
  if (arguments_.includes("--help") || arguments_.includes("-h")) return "help";
  const command = arguments_[0];
  if (!(["backup", "integrity", "list", "verify"] as const).includes(command as Command)) {
    throw new Error("A command is required: backup, integrity, list, or verify.");
  }
  const result: Arguments = {
    command: command as Command,
    databasePath: defaultDatabasePath(),
    uploadDirectory: defaultUploadDirectory(),
    backupDirectory: defaultBackupDirectory(),
    keepTemporary: false,
  };

  for (let index = 1; index < arguments_.length; index += 1) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (flag === "--database") {
      result.databasePath = requireValue(flag, value);
      index += 1;
    } else if (flag === "--uploads") {
      result.uploadDirectory = requireValue(flag, value);
      index += 1;
    } else if (flag === "--backup-dir") {
      result.backupDirectory = requireValue(flag, value);
      index += 1;
    } else if (flag === "--destination") {
      result.destinationDirectory = requireValue(flag, value);
      index += 1;
    } else if (flag === "--backup") {
      result.backupPath = requireValue(flag, value);
      index += 1;
    } else if (flag === "--keep-temporary") {
      result.keepTemporary = true;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  return result;
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options === "help") {
    process.stdout.write(usage());
    return;
  }

  if (options.command === "backup") {
    const result = await createBackupBundle({
      databasePath: options.databasePath,
      uploadDirectory: options.uploadDirectory,
      backupDirectory: options.backupDirectory,
      destinationDirectory: options.destinationDirectory,
    });
    output({ ok: true, operation: "backup", ...result });
    return;
  }

  if (options.command === "integrity") {
    const result = checkDatabaseIntegrity(options.databasePath);
    output({ operation: "integrity", ...result });
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (options.command === "list") {
    const backups = listBackupBundles(options.backupDirectory);
    output({
      ok: backups.every((backup) => backup.valid),
      operation: "list",
      backupDirectory: options.backupDirectory,
      count: backups.length,
      backups,
    });
    if (backups.some((backup) => !backup.valid)) process.exitCode = 1;
    return;
  }

  if (!options.backupPath) {
    throw new Error("verify requires --backup <backup-directory>.");
  }
  const result = await verifyBackupRestore(options.backupPath, {
    keepTemporary: options.keepTemporary,
  });
  output({ operation: "verify", ...result });
}

void main().catch((error: unknown) => {
  output({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
