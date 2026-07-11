import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { preferredEnvironmentValue } from "@/lib/runtime-config";

const VERSION = "v1";
const DEVELOPMENT_VERSION = "v0";
const AAD = Buffer.from("micro-linear:webhook-signing-secret:v1", "utf8");
const LEGACY_AAD = Buffer.from("orbit:webhook-signing-secret:v1", "utf8");

function keyMaterial(): string | null {
  return (
    preferredEnvironmentValue(
      process.env.MICRO_LINEAR_WEBHOOK_ENCRYPTION_KEY,
      process.env.ORBIT_WEBHOOK_ENCRYPTION_KEY,
    ) ||
    process.env.AUTH_TOKEN_PEPPER?.trim() ||
    null
  );
}

function encryptionKey(material: string): Buffer {
  return createHash("sha256").update(material, "utf8").digest();
}

/**
 * Encrypt a signing secret for storage. Development without a configured key
 * uses an explicit v0 encoding so local installs remain usable; production
 * deployments should always set MICRO_LINEAR_WEBHOOK_ENCRYPTION_KEY.
 */
export function sealWebhookSecret(secret: string): string {
  const material = keyMaterial();
  if (!material) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MICRO_LINEAR_WEBHOOK_ENCRYPTION_KEY is required in production.");
    }
    return `${DEVELOPMENT_VERSION}.${Buffer.from(secret, "utf8").toString("base64url")}`;
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(material), nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    nonce.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function unsealWebhookSecret(sealed: string): string {
  const [version, first, second, third] = sealed.split(".");
  if (version === DEVELOPMENT_VERSION && first && !second && !third) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Development webhook secrets cannot be used in production.");
    }
    return Buffer.from(first, "base64url").toString("utf8");
  }
  if (version !== VERSION || !first || !second || !third) {
    throw new Error("Stored webhook signing secret has an unsupported format.");
  }
  const material = keyMaterial();
  if (!material) {
    throw new Error("MICRO_LINEAR_WEBHOOK_ENCRYPTION_KEY is required to decrypt webhook secrets.");
  }

  const decrypt = (aad: Buffer): string => {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(material),
      Buffer.from(first, "base64url"),
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(second, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(third, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  };

  try {
    return decrypt(AAD);
  } catch {
    try {
      return decrypt(LEGACY_AAD);
    } catch {
      throw new Error("Webhook signing secret could not be decrypted with the configured key.");
    }
  }
}
