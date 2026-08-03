import { NextResponse } from "next/server";

import { AccountLifecycleError } from "@/modules/identity";
import { AdminError } from "@/modules/admin";
import { CatalogError } from "@/modules/catalog";
import { CollectionError } from "@/modules/collections";
import { AuthenticationError, EmailChangeError, InvitationError, RegistrationError } from "@/modules/identity";
import { DirectComparisonError, TradingError } from "@/modules/trading";

export function apiError(error: unknown): NextResponse {
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
  return NextResponse.json({ error: "The request could not be completed." }, { status: 500 });
}

export function requestBodyTooLarge(): NextResponse {
  return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
}
