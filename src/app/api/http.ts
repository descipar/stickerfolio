import { NextResponse } from "next/server";

import { AdminError } from "@/modules/admin";
import { CatalogError } from "@/modules/catalog";
import { CollectionError } from "@/modules/collections";
import { AuthenticationError, EmailChangeError } from "@/modules/identity";
import { TradingError } from "@/modules/trading";

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
  if (error instanceof EmailChangeError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof CollectionError) {
    return NextResponse.json(
      { error: error.status === 404 ? "Collection not found." : "The collection could not be updated." },
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
  return NextResponse.json({ error: "The request could not be completed." }, { status: 500 });
}

export function requestBodyTooLarge(): NextResponse {
  return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
}
