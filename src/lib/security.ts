import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE_NAME = "micro_linear_session";
export const LEGACY_SESSION_COOKIE_NAME = "orbit_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 32 * 1024 * 1024;
const PASSWORD_HASH_VERSION = "scrypt-v1";
const DUMMY_SALT = Buffer.from("micro-linear-auth-dummy-salt-v1", "utf8");

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export function readSessionCookie(cookies: CookieReader): string | undefined {
  return (
    cookies.get(SESSION_COOKIE_NAME)?.value ??
    cookies.get(LEGACY_SESSION_COOKIE_NAME)?.value
  );
}

export interface PasswordHashOptions {
  /** Intended for deterministic fixtures only. Production callers should omit it. */
  readonly salt?: Uint8Array;
}

export interface SessionCookieOptions {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
  readonly maxAge: number;
}

function derivePassword(password: string, salt: Uint8Array): Promise<Buffer> {
  const pepperedPassword = `${password}${process.env.AUTH_PASSWORD_PEPPER ?? ""}`;

  return new Promise((resolve, reject) => {
    scrypt(
      pepperedPassword,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(
  password: string,
  options: PasswordHashOptions = {},
): Promise<string> {
  const validationError = validatePassword(password);
  if (validationError) throw new Error(validationError);

  const salt = Buffer.from(options.salt ?? randomBytes(16));
  const derivedKey = await derivePassword(password, salt);

  return [
    PASSWORD_HASH_VERSION,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    SCRYPT_KEY_LENGTH,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length !== 7 || parts[0] !== PASSWORD_HASH_VERSION) return false;

  const [n, r, p, keyLength] = parts.slice(1, 5).map(Number);
  const saltPart = parts[5];
  const hashPart = parts[6];
  if (
    n !== SCRYPT_N ||
    r !== SCRYPT_R ||
    p !== SCRYPT_P ||
    keyLength !== SCRYPT_KEY_LENGTH ||
    !saltPart ||
    !hashPart
  ) {
    return false;
  }

  const expected = Buffer.from(hashPart, "base64url");
  if (expected.length !== SCRYPT_KEY_LENGTH) return false;

  const actual = await derivePassword(password, Buffer.from(saltPart, "base64url"));
  return timingSafeEqual(actual, expected);
}

/** Performs the same expensive work for missing accounts to reduce user-enumeration timing leaks. */
export async function verifyPasswordOrDummy(
  password: string,
  encodedHash: string | null,
): Promise<boolean> {
  if (encodedHash) return verifyPassword(password, encodedHash);
  await derivePassword(password, DUMMY_SALT);
  return false;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

export function normalizeEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

export function isPlausibleEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function normalizeDisplayName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  );
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  const pepper = process.env.AUTH_TOKEN_PEPPER ?? "";
  return createHash("sha256").update(token).update(pepper).digest("hex");
}

export function hashNetworkAddress(address: string | null): string | null {
  if (!address) return null;
  return createHash("sha256").update(address).digest("hex");
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function getSessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  };
}

export function isTrustedRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  const allowedOrigins = new Set([new URL(request.url).origin]);
  if (process.env.APP_URL) {
    try {
      allowedOrigins.add(new URL(process.env.APP_URL).origin);
    } catch {
      // A malformed deployment variable should not make unrelated local requests fail.
    }
  }
  return allowedOrigins.has(origin);
}
