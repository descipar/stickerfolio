import { NextResponse } from "next/server";

import { getEnvironment } from "@/infrastructure/config";
import {
  buildContentSecurityPolicy,
  createCspNonce,
  getRateLimitClientKey,
  InMemoryFixedWindowRateLimiter,
  isUnsafeCrossOriginRequest,
  untrustedIpSinkHeader,
} from "@/infrastructure/http";

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

  const contentSecurityPolicy = buildContentSecurityPolicy(
    createCspNonce(),
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(untrustedIpSinkHeader);
  // Next.js extracts the nonce from this request header and applies it to its scripts.
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

// Every request except build assets, which carry no CSP-relevant content.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
