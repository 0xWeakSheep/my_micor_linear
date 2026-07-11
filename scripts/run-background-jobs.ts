import { closeDatabase, getDatabase } from "../src/lib/db";
import { runBackgroundJobs } from "../src/modules/background";

interface CliOptions {
  now?: Date;
  recurringLimit?: number;
  cycleLimit?: number;
  webhookLimit?: number;
}

function usage(): string {
  return `Run Micro Linear background work once (safe for cron/systemd timers).

Usage:
  npm run jobs:run -- [options]

Options:
  --now <ISO timestamp>       Override current time (diagnostics only)
  --recurring-limit <number>  Maximum recurring definitions to scan
  --cycle-limit <number>      Maximum cycles to scan
  --webhook-limit <number>    Maximum outbox events to claim
  --help                      Show this message
`;
}

function positiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return parsed;
}

function parseArguments(arguments_: string[]): CliOptions | "help" {
  const options: CliOptions = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help" || argument === "-h") return "help";
    const value = arguments_[index + 1];
    if (argument === "--now") {
      const date = new Date(value ?? "");
      if (Number.isNaN(date.getTime())) throw new Error("--now requires an ISO timestamp.");
      options.now = date;
      index += 1;
    } else if (argument === "--recurring-limit") {
      options.recurringLimit = positiveInteger(argument, value);
      index += 1;
    } else if (argument === "--cycle-limit") {
      options.cycleLimit = positiveInteger(argument, value);
      index += 1;
    } else if (argument === "--webhook-limit") {
      options.webhookLimit = positiveInteger(argument, value);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options === "help") {
    process.stdout.write(usage());
    return;
  }

  const result = await runBackgroundJobs({
    database: getDatabase(),
    now: options.now,
    recurring: { limit: options.recurringLimit },
    cycles: { limit: options.cycleLimit },
    webhooks: { limit: options.webhookLimit },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  const errors = [
    ...result.recurring.errors,
    ...result.cycles.errors,
    ...result.maintenance.errors,
    ...result.webhooks.errors,
  ];
  if (errors.length > 0 || result.webhooks.terminalFailures > 0) process.exitCode = 1;
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
