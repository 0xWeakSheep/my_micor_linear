import { loadEnvConfig } from "@next/env";

import {
  preferredEnvironmentFlag,
  preferredEnvironmentValue,
} from "../src/lib/runtime-config";

loadEnvConfig(process.cwd());

const secrets = [
  { name: "AUTH_PASSWORD_PEPPER", value: process.env.AUTH_PASSWORD_PEPPER },
  { name: "AUTH_TOKEN_PEPPER", value: process.env.AUTH_TOKEN_PEPPER },
  {
    name: "MICRO_LINEAR_WEBHOOK_ENCRYPTION_KEY",
    value: preferredEnvironmentValue(
      process.env.MICRO_LINEAR_WEBHOOK_ENCRYPTION_KEY,
      process.env.ORBIT_WEBHOOK_ENCRYPTION_KEY,
    ),
  },
] as const;

const errors: string[] = [];
const appUrlValue = process.env.APP_URL?.trim();

if (process.env.NODE_ENV && process.env.NODE_ENV !== "production") {
  errors.push("NODE_ENV must not be explicitly set to a non-production value.");
}

if (!appUrlValue) {
  errors.push("APP_URL is required.");
} else {
  try {
    const appUrl = new URL(appUrlValue);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(appUrl.hostname);
    if (!isLocal && appUrl.protocol !== "https:") {
      errors.push("APP_URL must use HTTPS outside localhost.");
    }
    if (!["http:", "https:"].includes(appUrl.protocol)) {
      errors.push("APP_URL must use HTTP or HTTPS.");
    }
    if (appUrl.username || appUrl.password || appUrl.search || appUrl.hash || appUrl.pathname !== "/") {
      errors.push("APP_URL must be an origin without credentials, path, query, or fragment.");
    }
  } catch {
    errors.push("APP_URL must be a valid absolute URL.");
  }
}

const configuredSecrets = secrets.map(({ name, value: rawValue }) => {
  const value = rawValue?.trim() ?? "";
  if (value.length < 32) errors.push(`${name} must contain at least 32 characters.`);
  if (/replace[-_ ]?with|change[-_ ]?me|placeholder/i.test(value)) {
    errors.push(`${name} must not use a documented placeholder value.`);
  }
  return value;
});

if (configuredSecrets.every((value) => value.length >= 32) && new Set(configuredSecrets).size !== configuredSecrets.length) {
  errors.push("Authentication and webhook secrets must use independent values.");
}

if (
  preferredEnvironmentFlag(
    process.env.MICRO_LINEAR_DEMO_MODE,
    process.env.ORBIT_DEMO_MODE,
  )
) {
  errors.push("MICRO_LINEAR_DEMO_MODE must not be enabled for a production start.");
}
if (
  preferredEnvironmentFlag(
    process.env.MICRO_LINEAR_WEBHOOK_ALLOW_INSECURE_LOCALHOST,
    process.env.ORBIT_WEBHOOK_ALLOW_INSECURE_LOCALHOST,
  )
) {
  errors.push("MICRO_LINEAR_WEBHOOK_ALLOW_INSECURE_LOCALHOST must not be enabled for a production start.");
}

if (errors.length > 0) {
  console.error("Micro Linear production configuration is unsafe:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Micro Linear production configuration validated.");
}
