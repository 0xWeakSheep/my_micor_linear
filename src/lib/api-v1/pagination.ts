import "server-only";

import { ApiV1Error } from "./http";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const MAX_CURSOR_LENGTH = 2_048;
const CURSOR_VERSION = 1;

interface CursorEnvelope {
  readonly position: unknown;
  readonly resource: string;
  readonly version: typeof CURSOR_VERSION;
}

export interface ApiV1Pagination<TCursor> {
  readonly cursor: TCursor | null;
  readonly limit: number;
}

function invalidPagination(message: string): ApiV1Error {
  return new ApiV1Error(400, "invalid_pagination", message);
}

function parseLimit(searchParams: URLSearchParams): number {
  const values = searchParams.getAll("limit");
  if (values.length === 0) return DEFAULT_PAGE_LIMIT;
  if (values.length > 1 || !/^[1-9]\d*$/.test(values[0] ?? "")) {
    throw invalidPagination("The limit query parameter must be a whole number.");
  }

  const limit = Number(values[0]);
  if (!Number.isSafeInteger(limit) || limit > MAX_PAGE_LIMIT) {
    throw invalidPagination(`The limit query parameter must be between 1 and ${MAX_PAGE_LIMIT}.`);
  }
  return limit;
}

function decodeCursor(value: string, resource: string): unknown {
  if (
    value.length === 0 ||
    value.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw invalidPagination("The cursor query parameter is invalid.");
  }

  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) {
      throw invalidPagination("The cursor query parameter is invalid.");
    }
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("version" in parsed) ||
      parsed.version !== CURSOR_VERSION ||
      !("resource" in parsed) ||
      parsed.resource !== resource ||
      !("position" in parsed)
    ) {
      throw invalidPagination("The cursor query parameter is invalid for this resource.");
    }
    return parsed.position;
  } catch (error) {
    if (error instanceof ApiV1Error) throw error;
    throw invalidPagination("The cursor query parameter is invalid.");
  }
}

export function encodeApiV1Cursor<TCursor>(resource: string, position: TCursor): string {
  const envelope: CursorEnvelope = {
    position,
    resource,
    version: CURSOR_VERSION,
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

export function readApiV1Pagination<TCursor>(
  request: Request,
  resource: string,
  isCursor: (position: unknown) => position is TCursor,
): ApiV1Pagination<TCursor> {
  const searchParams = new URL(request.url).searchParams;
  const cursorValues = searchParams.getAll("cursor");
  if (cursorValues.length > 1) {
    throw invalidPagination("The cursor query parameter may only be provided once.");
  }

  const encodedCursor = cursorValues[0];
  if (!encodedCursor) return { cursor: null, limit: parseLimit(searchParams) };

  const position = decodeCursor(encodedCursor, resource);
  if (!isCursor(position)) {
    throw invalidPagination("The cursor query parameter is invalid for this resource.");
  }
  return { cursor: position, limit: parseLimit(searchParams) };
}
