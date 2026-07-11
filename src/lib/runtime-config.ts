export function preferredEnvironmentValue(
  primaryValue: string | undefined,
  legacyValue?: string | undefined,
): string | undefined {
  const primary = primaryValue?.trim();
  if (primary) return primary;
  const legacy = legacyValue?.trim();
  return legacy || undefined;
}

export function preferredEnvironmentFlag(
  primaryValue: string | undefined,
  legacyValue?: string | undefined,
): boolean {
  return preferredEnvironmentValue(primaryValue, legacyValue) === "1";
}
