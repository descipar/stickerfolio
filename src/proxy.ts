import { NextResponse } from "next/server";

import { getEnvironment } from "@/infrastructure/config";
import {
  getRateLimitClientKey,
  InMemoryFixedWindowRateLimiter,
  isUnsafeCrossOriginRequest,
  untrustedIpSinkHeader,
} from "@/infrastructure/http";

const invitationRedemptionLimiter = new InMemoryFixedWindowRateLimiter();

export function proxy(request: Request): Response {
  const environment = getEnvironment();

  if (isUnsafeCrossOriginRequest(request, environment.appBaseUrl.origin)) {
    return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  }

  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/api/invitations/redeem") {
    const decision = invitationRedemptionLimiter.consume(
      getRateLimitClientKey(request, environment.auth.trustedIpHeader),
      5,
      60_000,
    );
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(decision.retryAfterSeconds) },
        },
      );
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(untrustedIpSinkHeader);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = { matcher: "/api/:path*" };
