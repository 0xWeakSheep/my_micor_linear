import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

export interface WebhookUrlOptions {
  resolveHost?: ResolveHost;
  allowInsecureLocalhost?: boolean;
}

export class WebhookUrlError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "WebhookUrlError";
  }
}

async function defaultResolveHost(hostname: string): Promise<ResolvedAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

function parseIpv4(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  return address.split(".").map(Number);
}

export function isPublicNetworkAddress(rawAddress: string): boolean {
  const address = rawAddress.replace(/^\[|\]$/g, "").toLocaleLowerCase();
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    const [a, b, c] = ipv4;
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 192 && b === 88 && c === 99) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }

  if (isIP(address) !== 6) return false;
  if (address === "::" || address === "::1") return false;
  const mappedIpv4 = address.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPublicNetworkAddress(mappedIpv4);
  const mappedHex = address.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1]!, 16);
    const low = Number.parseInt(mappedHex[2]!, 16);
    return isPublicNetworkAddress(
      `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
    );
  }
  if (address.startsWith("::")) return false;

  const first = address.split(":")[0] ?? "";
  if (/^f[cd]/.test(first)) return false; // Unique-local fc00::/7.
  if (/^fe[89ab]/.test(first)) return false; // Link-local fe80::/10.
  if (/^ff/.test(first)) return false; // Multicast.
  if (address.startsWith("2001:db8:")) return false; // Documentation.
  if (address.startsWith("2001:2:") || address.startsWith("2001:10:")) return false;
  return true;
}

function localHostname(hostname: string): boolean {
  const normalized = hostname.replace(/\.$/, "").toLocaleLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan") ||
    normalized.endsWith(".home")
  );
}

export async function assertSafeWebhookUrl(
  rawUrl: string,
  options: WebhookUrlOptions = {},
): Promise<URL> {
  if (rawUrl.length > 2_048) {
    throw new WebhookUrlError("Webhook URL is too long.", true);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookUrlError("Webhook URL is invalid.", true);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const allowLocalHttp =
    options.allowInsecureLocalhost === true &&
    url.protocol === "http:" &&
    (localHostname(hostname) || (isIP(hostname) > 0 && !isPublicNetworkAddress(hostname)));

  if (url.protocol !== "https:" && !allowLocalHttp) {
    throw new WebhookUrlError("Webhook URL must use HTTPS.", true);
  }
  if (url.username || url.password) {
    throw new WebhookUrlError("Webhook URL cannot contain credentials.", true);
  }
  if (url.hash) {
    throw new WebhookUrlError("Webhook URL cannot contain a fragment.", true);
  }
  if (!hostname || (localHostname(hostname) && !allowLocalHttp)) {
    throw new WebhookUrlError("Webhook URL cannot target a local hostname.", true);
  }

  if (allowLocalHttp) return url;

  if (isIP(hostname) > 0) {
    if (!isPublicNetworkAddress(hostname) && !allowLocalHttp) {
      throw new WebhookUrlError("Webhook URL cannot target a private network.", true);
    }
    return url;
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await (options.resolveHost ?? defaultResolveHost)(hostname);
  } catch {
    throw new WebhookUrlError("Webhook hostname could not be resolved.", false);
  }
  if (addresses.length === 0) {
    throw new WebhookUrlError("Webhook hostname did not resolve to an address.", false);
  }
  if (addresses.some((entry) => !isPublicNetworkAddress(entry.address))) {
    throw new WebhookUrlError("Webhook hostname resolves to a private network.", true);
  }
  return url;
}
