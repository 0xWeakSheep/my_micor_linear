import { describe, expect, it } from "vitest";

import {
  LEGACY_SESSION_COOKIE_NAME,
  readSessionCookie,
  SESSION_COOKIE_NAME,
} from "./security";

describe("session cookie brand migration", () => {
  it("prefers the current cookie and still accepts the legacy cookie", () => {
    expect(
      readSessionCookie({
        get: (name) =>
          name === SESSION_COOKIE_NAME
            ? { value: "current-token" }
            : name === LEGACY_SESSION_COOKIE_NAME
              ? { value: "legacy-token" }
              : undefined,
      }),
    ).toBe("current-token");

    expect(
      readSessionCookie({
        get: (name) =>
          name === LEGACY_SESSION_COOKIE_NAME ? { value: "legacy-token" } : undefined,
      }),
    ).toBe("legacy-token");
  });
});
