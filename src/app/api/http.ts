import { NextResponse } from "next/server";

import { resolveSessionPrincipal } from "@/auth";
import { writeLog } from "@/infrastructure/observability";

import { AccountLifecycleError } from "@/modules/identity";
import { AdminError } from "@/modules/admin";
import { CatalogError } from "@/modules/catalog";
import { CollectionError } from "@/modules/collections";
import { EmailChangeError, InvitationError, RegistrationError } from "@/modules/identity";
import { AuthenticationError, type Principal } from "@/shared/principal";
import { DirectComparisonError, TradingError } from "@/modules/trading";

const identifierSegment = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{16,})$/i;

/** Method and path with identifiers and tokens replaced, e.g. `PUT /api/collections/:id/holdings/:id`. */
export function describeRoute(request: Request): string {
  const pathname = new URL(request.url).pathname
    .split("/")
    .map((segment) => (identifierSegment.test(segment) ? ":id" : segment))
    .join("/");
  return `${request.method} ${pathname}`;
}

/**
 * Maps known domain errors to their HTTP response. Anything else is an
 * unexpected failure: it is logged once, redacted, with the route (#129), and
 * the client receives a generic 500.
 */
export function apiError(error: unknown, request?: Request): NextResponse {
  if (error instanceof AdminError) {
    return NextResponse.json(
      { error: error.status === 401 ? "Authentication required." : error.message },
      { status: error.status },
    );
  }
  if (error instanceof AuthenticationError) {
    return NextResponse.json(
      { error: error.status === 401 ? "Authentication required." : "Access denied." },
      { status: error.status },
    );
  }
  if (error instanceof RegistrationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof InvitationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof EmailChangeError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof AccountLifecycleError) {
    return NextResponse.json(
      { error: error.status === 401 ? "Authentication required." : error.message },
      { status: error.status },
    );
  }
  if (error instanceof CollectionError) {
    return NextResponse.json(
      {
        error:
          error.status === 404
            ? "Collection not found."
            : error.status === 409
              ? error.message
              : "The collection could not be updated.",
      },
      { status: error.status },
    );
  }
  if (error instanceof CatalogError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof TradingError) {
    return NextResponse.json(
      { error: error.status === 404 ? "Collection not found." : "Trade matches could not be loaded." },
      { status: error.status },
    );
  }
  if (error instanceof DirectComparisonError) {
    return NextResponse.json({ error: "Comparison unavailable." }, { status: error.status });
  }
  writeLog("error", "api.unexpected_error", {
    route: request ? describeRoute(request) : null,
    error: error instanceof Error ? error : { name: typeof error, message: String(error) },
  });
  return NextResponse.json({ error: "The request could not be completed." }, { status: 500 });
}

/** Resolves the request's principal through the cookie-session adapter (#126). */
export function principalOf(request: Request): Promise<Principal | null> {
  return resolveSessionPrincipal(request.headers);
}

export function requestBodyTooLarge(): NextResponse {
  return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
}
