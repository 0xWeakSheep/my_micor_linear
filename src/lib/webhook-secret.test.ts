import { createCipheriv, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sealWebhookSecret, unsealWebhookSecret } from "./webhook-secret";

function legacyCiphertext(secret: string, material: string): string {
  const nonce = Buffer.alloc(12, 7);
  const key = createHash("sha256").update(material, "utf8").digest();
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("orbit:webhook-signing-secret:v1", "utf8"));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

afterEach(() => vi.unstubAllEnvs());

describe("webhook secret brand migration", () => {
  it("reads both current and legacy authenticated ciphertext", () => {
    const key = "micro-linear-webhook-test-key-with-32-characters";
    vi.stubEnv("MICRO_LINEAR_WEBHOOK_ENCRYPTION_KEY", key);

    expect(unsealWebhookSecret(sealWebhookSecret("current-secret"))).toBe("current-secret");
    expect(unsealWebhookSecret(legacyCiphertext("legacy-secret", key))).toBe("legacy-secret");
  });
});
