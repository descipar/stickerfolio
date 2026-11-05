import { createHash } from "node:crypto";

import { z } from "zod";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export const untrustedIpSinkHeader = "x-stickerfolio-untrusted-ip-sink";

export function isUnsafeCrossOriginRequest(request: Request, applicationOrigin: string): boolean {
  if (safeMethods.has(request.method.toUpperCase())) return false;

  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== applicationOrigin;
  } catch {
    return true;
  }
}

interface RateLimitEntry {
  count: number;
  resetsAt: number;
}

export class InMemoryFixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  consume(key: string, maximum: number, windowMs: number, now = Date.now()) {
    const current = this.entries.get(key);
    if (!current || current.resetsAt <= now) {
      this.entries.set(key, { count: 1, resetsAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= maximum) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetsAt - now) / 1000)),
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Written by `scripts/client-address-preload.mjs` from the connection's socket
 * address, overwriting any value a client sent. Only trusted while that preload
 * is active in this process.
 */
export const clientAddressHeader = "x-stickerfolio-client-address";
const clientAddressPreloadMarker = Symbol.for("stickerfolio.clientAddressPreload");

/** Key used when no per-client address can be trusted; all such clients share it. */
export const sharedClientKey = "no-trusted-client-ip";

export function isClientAddressPreloadActive(): boolean {
  return (globalThis as Record<symbol, unknown>)[clientAddressPreloadMarker] === true;
}

/**
 * The header that identifies a client: the operator-configured proxy header if
 * set, otherwise the socket address recorded by the preload. Returns undefined
 * when neither can be trusted (#124).
 */
export function resolveClientAddressHeader(
  trustedIpHeader?: string,
  preloadActive = isClientAddressPreloadActive(),
): string | undefined {
  if (trustedIpHeader) return trustedIpHeader;
  return preloadActive ? clientAddressHeader : undefined;
}

export function getRateLimitClientKey(
  request: Request,
  trustedIpHeader?: string,
  preloadActive = isClientAddressPreloadActive(),
): string {
  const header = resolveClientAddressHeader(trustedIpHeader, preloadActive);
  if (!header) return sharedClientKey;
  const value = request.headers.get(header)?.trim();
  const address = z.union([z.ipv4(), z.ipv6()]).safeParse(value);
  return address.success ? address.data : sharedClientKey;
}

const sessionCookieNames = ["__Secure-better-auth.session_token", "better-auth.session_token"];

/**
 * Rate-limit key for authenticated endpoints: one bucket per session, so
 * signed-in users never share a bucket through a common client address.
 * Requests without a session cookie fall back to the client key; they are
 * rejected as unauthenticated by the use case anyway.
 */
export function getAuthenticatedRateLimitKey(
  request: Request,
  trustedIpHeader?: string,
  preloadActive = isClientAddressPreloadActive(),
): string {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (value && sessionCookieNames.includes(name)) {
      return `session:${createHash("sha256").update(value).digest("hex")}`;
    }
  }
  return `client:${getRateLimitClientKey(request, trustedIpHeader, preloadActive)}`;
}
