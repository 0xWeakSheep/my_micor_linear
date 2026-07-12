import "server-only";

import { preferredEnvironmentValue } from "@/lib/runtime-config";
import { runBackgroundJobs } from "@/modules/background/service";

type JobImplementation = () => Promise<unknown>;

interface RunnerState {
  running: boolean;
  stop?: () => void;
  timer?: ReturnType<typeof setInterval>;
}

const globalState = globalThis as typeof globalThis & {
  __microLinearBackgroundRunner?: RunnerState;
};

function state(): RunnerState {
  globalState.__microLinearBackgroundRunner ??= { running: false };
  return globalState.__microLinearBackgroundRunner;
}

function disabledByEnvironment(): boolean {
  const value = preferredEnvironmentValue(
    process.env.MICRO_LINEAR_BACKGROUND_JOBS_DISABLED,
    process.env.ORBIT_BACKGROUND_JOBS_DISABLED,
  )?.toLowerCase();
  return value === "1" || value === "true";
}

function configuredIntervalMs(): number {
  const value = preferredEnvironmentValue(
    process.env.MICRO_LINEAR_BACKGROUND_JOBS_INTERVAL_MS,
    process.env.ORBIT_BACKGROUND_JOBS_INTERVAL_MS,
  );
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(parsed, 300_000)) : 5_000;
}

export function startBackgroundJobRunner(
  options: {
    readonly intervalMs?: number;
    readonly runImplementation?: JobImplementation;
  } = {},
): () => void {
  const runner = state();
  if (runner.timer && runner.stop) return runner.stop;
  if (!options.runImplementation && disabledByEnvironment()) return () => undefined;

  const intervalMs = Math.max(1_000, options.intervalMs ?? configuredIntervalMs());
  const run = options.runImplementation ?? (() => runBackgroundJobs());
  const tick = async (): Promise<void> => {
    if (runner.running) return;
    runner.running = true;
    try {
      await run();
    } catch (error) {
      console.error("Background jobs failed", error);
    } finally {
      runner.running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  runner.timer = timer;
  runner.stop = () => {
    if (runner.timer === timer) {
      clearInterval(timer);
      runner.timer = undefined;
      runner.stop = undefined;
      runner.running = false;
    }
  };
  return runner.stop;
}
