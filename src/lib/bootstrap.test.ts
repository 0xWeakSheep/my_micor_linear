// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensureSeedData } from "@/lib/bootstrap";
import { closeDatabase, getOne } from "@/lib/db";

let temporaryDirectory = "";

afterEach(() => {
  closeDatabase();
  vi.unstubAllEnvs();
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
});

describe("demo bootstrap policy", () => {
  it("never creates demo accounts in production even when demo mode is requested", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "micro-linear-bootstrap-"));
    vi.stubEnv("MICRO_LINEAR_DB_PATH", join(temporaryDirectory, "empty.db"));
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MICRO_LINEAR_DEMO_MODE", "1");

    expect(ensureSeedData()).toBe(false);
    expect(getOne<{ count: number }>("SELECT COUNT(*) AS count FROM users")).toEqual({ count: 0 });
  });
});
