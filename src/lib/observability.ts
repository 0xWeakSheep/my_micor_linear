import { randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, unknown>>;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface StructuredLogEntry {
  [key: string]: JsonValue;
  timestamp: string;
  level: LogLevel;
  event: string;
}

export type StructuredLogSink = (line: string, entry: StructuredLogEntry) => void;

export interface StructuredLogOptions {
  now?: Date;
  sink?: StructuredLogSink;
}

export interface RequestObservationOptions extends StructuredLogOptions {
  monotonicNow?: () => number;
}

export interface RequestObservation {
  readonly requestId: string;
  complete: (status: number, fields?: LogFields, error?: unknown) => void;
  withResponseHeaders: <T extends Response>(response: T) => T;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const TRACEPARENT_PATTERN = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}(?:-[\x20-\x7e]+)?$/i;
const MAX_STRING_LENGTH = 8_192;
const MAX_DEPTH = 6;
const MAX_COLLECTION_LENGTH = 100;

function truncate(value: string, maximum = MAX_STRING_LENGTH): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…[truncated]`;
}

function toJsonValue(value: unknown, seen: WeakSet<object>, depth: number): JsonValue {
  if (value === null) return null;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return null;
  if (typeof value === "symbol" || typeof value === "function") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message, 4_096),
      ...(value.stack ? { stack: truncate(value.stack) } : {}),
    };
  }
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_COLLECTION_LENGTH)
        .map((entry) => toJsonValue(entry, seen, depth + 1));
    }
    const output = Object.create(null) as Record<string, JsonValue>;
    for (const [key, entry] of Object.entries(value).slice(0, MAX_COLLECTION_LENGTH)) {
      output[key] = toJsonValue(entry, seen, depth + 1);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function defaultSink(line: string, entry: StructuredLogEntry): void {
  if (process.env.NODE_ENV === "test") return;
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.info(line);
}

export function structuredLog(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  options: StructuredLogOptions = {},
): StructuredLogEntry {
  const normalized = toJsonValue(fields, new WeakSet(), 0);
  const entry = {
    ...(typeof normalized === "object" && normalized !== null && !Array.isArray(normalized)
      ? normalized
      : {}),
    timestamp: (options.now ?? new Date()).toISOString(),
    level,
    event: truncate(event, 160),
  } satisfies StructuredLogEntry;
  const line = JSON.stringify(entry);
  (options.sink ?? defaultSink)(line, entry);
  return entry;
}

export function requestIdFor(request: Request): string {
  const incoming = request.headers.get("x-request-id")?.trim();
  if (incoming && REQUEST_ID_PATTERN.test(incoming)) return incoming;
  const traceId = TRACEPARENT_PATTERN.exec(request.headers.get("traceparent")?.trim() ?? "")?.[1];
  if (traceId && !/^0+$/.test(traceId)) return `req_${traceId.toLocaleLowerCase()}`;
  return `req_${randomUUID().replaceAll("-", "")}`;
}

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "/";
  }
}

export function observeRequest(
  request: Request,
  operation: string,
  options: RequestObservationOptions = {},
): RequestObservation {
  const requestId = requestIdFor(request);
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const startedAt = monotonicNow();
  let completed = false;

  return {
    requestId,
    complete(status, fields = {}, error) {
      if (completed) return;
      completed = true;
      const durationMs = Math.max(0, Number((monotonicNow() - startedAt).toFixed(2)));
      const level: LogLevel = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      structuredLog(
        level,
        "http.request.completed",
        {
          ...fields,
          requestId,
          operation,
          method: request.method,
          path: requestPath(request),
          status,
          durationMs,
          ...(error === undefined ? {} : { error }),
        },
        options,
      );
    },
    withResponseHeaders<T extends Response>(response: T): T {
      response.headers.set("X-Request-Id", requestId);
      return response;
    },
  };
}
