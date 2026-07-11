import "server-only";

import { NextResponse } from "next/server";

import { AuthenticationError, PermissionError } from "@/lib/auth";
import {
  BootstrapNotFoundError,
  BootstrapPermissionError,
} from "@/lib/bootstrap";
import { getOne, nowIso, run } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/domain";
import { observeRequest } from "@/lib/observability";
import { hashOpaqueToken } from "@/lib/security";
import {
  ConflictError,
  DomainValidationError,
  ResourceNotFoundError,
} from "@/modules/shared/mutation";

export const API_V1_SCOPES = [
  "workspace:read",
  "issues:read",
  "issues:write",
  "projects:read",
  "projects:write",
  "webhooks:manage",
] as const;

export type ApiV1Scope = (typeof API_V1_SCOPES)[number];

export interface ApiV1Context {
  readonly apiKeyId: string;
  readonly requestId: string;
  readonly role: WorkspaceRole;
  readonly scopes: ReadonlySet<string>;
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
}

interface ApiKeyRow {
  api_key_id: string;
  user_id: string;
  workspace_id: string;
  workspace_slug: string;
  role: WorkspaceRole;
  membership_status: "active" | "suspended";
  disabled_at: string | null;
  scopes_json: string;
  expires_at: string | null;
}

export interface ApiV1ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

export interface ApiV1DataBody<T> {
  readonly data: T;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export class ApiV1Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly authenticateHeader?: string,
  ) {
    super(message);
    this.name = "ApiV1Error";
  }
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

function invalidToken(message = "The bearer token is invalid or no longer active."): ApiV1Error {
  return new ApiV1Error(
    401,
    "invalid_token",
    message,
    'Bearer realm="Orbit API", error="invalid_token"',
  );
}

function parseBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    throw new ApiV1Error(
      401,
      "authentication_required",
      "A bearer API token is required.",
      'Bearer realm="Orbit API"',
    );
  }

  const match = /^Bearer[\t ]+([^\s,]+)$/i.exec(authorization);
  const token = match?.[1];
  if (!token || token.length > 512) throw invalidToken();
  return token;
}

function parseScopes(value: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((scope): scope is string => typeof scope === "string"));
  } catch {
    return new Set();
  }
}

function authenticate(
  request: Request,
  requestId: string,
  requiredScopes: readonly ApiV1Scope[],
): ApiV1Context {
  const token = parseBearerToken(request);
  const row = getOne<ApiKeyRow>(
    `SELECT ak.id AS api_key_id, ak.user_id, ak.workspace_id,
            w.slug AS workspace_slug, wm.role, wm.status AS membership_status,
            u.disabled_at, ak.scopes_json, ak.expires_at
       FROM api_keys ak
       JOIN workspaces w ON w.id = ak.workspace_id
       JOIN users u ON u.id = ak.user_id
       JOIN workspace_members wm
         ON wm.workspace_id = ak.workspace_id AND wm.user_id = ak.user_id
      WHERE ak.token_hash = ?`,
    hashOpaqueToken(token),
  );

  if (!row || row.disabled_at || row.membership_status !== "active") throw invalidToken();
  if (row.expires_at) {
    const expiry = Date.parse(row.expires_at);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw invalidToken();
  }

  const scopes = parseScopes(row.scopes_json);
  run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", nowIso(), row.api_key_id);

  const missingScopes = requiredScopes.filter((scope) => !scopes.has(scope));
  if (missingScopes.length > 0) {
    throw new ApiV1Error(
      403,
      "insufficient_scope",
      `This API token requires the following scope: ${missingScopes.join(", ")}.`,
      `Bearer realm="Orbit API", error="insufficient_scope", scope="${missingScopes.join(" ")}"`,
    );
  }

  return {
    apiKeyId: row.api_key_id,
    requestId,
    role: row.role,
    scopes,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    workspaceSlug: row.workspace_slug,
  };
}

function errorDetails(error: unknown): {
  status: number;
  code: string;
  message: string;
  authenticateHeader?: string;
} {
  if (error instanceof ApiV1Error) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      authenticateHeader: error.authenticateHeader,
    };
  }
  if (error instanceof AuthenticationError) {
    return {
      status: 401,
      code: "invalid_token",
      message: error.message,
      authenticateHeader: 'Bearer realm="Orbit API", error="invalid_token"',
    };
  }
  if (error instanceof PermissionError) {
    return { status: 403, code: "forbidden", message: error.message };
  }
  if (error instanceof ResourceNotFoundError) {
    return { status: 404, code: "not_found", message: error.message };
  }
  if (error instanceof BootstrapNotFoundError) {
    return { status: error.status, code: "not_found", message: error.message };
  }
  if (error instanceof BootstrapPermissionError) {
    return { status: error.status, code: "forbidden", message: error.message };
  }
  if (error instanceof ConflictError) {
    return { status: 409, code: "conflict", message: error.message };
  }
  if (error instanceof DomainValidationError) {
    return { status: error.status, code: "validation_error", message: error.message };
  }
  if (error instanceof SyntaxError) {
    return { status: 400, code: "invalid_json", message: "The request body must be valid JSON." };
  }
  return {
    status: 500,
    code: "internal_error",
    message: "The API request could not be completed.",
  };
}

export function apiV1Data<T>(
  data: T,
  options: {
    readonly headers?: HeadersInit;
    readonly meta?: Readonly<Record<string, unknown>>;
    readonly status?: number;
  } = {},
): NextResponse<ApiV1DataBody<T>> {
  const headers = new Headers(NO_STORE_HEADERS);
  new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  return NextResponse.json(
    { data, ...(options.meta ? { meta: options.meta } : {}) },
    {
      status: options.status ?? 200,
      headers,
    },
  );
}

export function apiV1List<T>(
  data: readonly T[],
  context: Pick<ApiV1Context, "workspaceId">,
): NextResponse<ApiV1DataBody<readonly T[]>> {
  return apiV1Data(data, {
    meta: { count: data.length, workspaceId: context.workspaceId },
  });
}

export async function withApiV1(
  request: Request,
  requiredScopes: ApiV1Scope | readonly ApiV1Scope[],
  handler: (context: ApiV1Context) => Response | Promise<Response>,
): Promise<Response> {
  const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
  const observation = observeRequest(request, "api.v1");
  const requestId = observation.requestId;
  let context: ApiV1Context | undefined;
  try {
    context = authenticate(request, requestId, scopes);
    const response = await handler(context);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    observation.complete(response.status, {
      apiKeyId: context.apiKeyId,
      workspaceId: context.workspaceId,
      requiredScopes: scopes,
    });
    return observation.withResponseHeaders(response);
  } catch (error) {
    const details = errorDetails(error);
    const response = NextResponse.json<ApiV1ErrorBody>(
      {
        error: {
          code: details.code,
          message: details.message,
          requestId,
        },
      },
      {
        status: details.status,
        headers: {
          ...NO_STORE_HEADERS,
          "X-Request-Id": requestId,
          ...(details.authenticateHeader
            ? { "WWW-Authenticate": details.authenticateHeader }
            : {}),
        },
      },
    );
    observation.complete(
      details.status,
      {
        code: details.code,
        requiredScopes: scopes,
        ...(context
          ? { apiKeyId: context.apiKeyId, workspaceId: context.workspaceId }
          : {}),
      },
      details.status >= 500 ? error : undefined,
    );
    return observation.withResponseHeaders(response);
  }
}
