import { NextResponse } from "next/server";

import { getEnvironment } from "@/infrastructure/config";
import {
  getRateLimitClientKey,
  InMemoryFixedWindowRateLimiter,
  isUnsafeCrossOriginRequest,
  untrustedIpSinkHeader,
} from "@/infrastructure/http";

const invitationRedemptionLimiter = new InMemoryFixedWindowRateLimiter();
const publicShareLimiter = new InMemoryFixedWindowRateLimiter();

export function proxy(request: Request): Response {
  const environment = getEnvironment();

  if (isUnsafeCrossOriginRequest(request, environment.appBaseUrl.origin)) {
    return NextResponse.json({ error: "Request rejected." }, { status: 403 });
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.startsWith("/share/")) {
    const decision = publicShareLimiter.consume(
      `public-share:${getRateLimitClientKey(request, environment.auth.trustedIpHeader)}`,
      120,
      60_000,
    );
    if (!decision.allowed) {
      return new NextResponse("Too many requests. Please try again later.", {
        status: 429,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": String(decision.retryAfterSeconds),
        },
      });
    }
  }

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

export const config = { matcher: ["/api/:path*", "/share/:path*"] };
