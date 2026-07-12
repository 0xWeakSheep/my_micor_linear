import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { startBackgroundJobRunner } from "./background-runner";

afterEach(() => {
  vi.useRealTimers();
});

describe("background job runner", () => {
  it("runs immediately, repeats, and stops without overlapping", async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const runImplementation = vi.fn(
      () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const stop = startBackgroundJobRunner({ intervalMs: 1_000, runImplementation });

    expect(runImplementation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runImplementation).toHaveBeenCalledTimes(1);

    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runImplementation).toHaveBeenCalledTimes(2);

    stop();
    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runImplementation).toHaveBeenCalledTimes(2);
  });
});
