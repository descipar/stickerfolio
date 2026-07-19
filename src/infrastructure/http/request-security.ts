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

export function getRateLimitClientKey(request: Request, trustedIpHeader?: string): string {
  if (!trustedIpHeader) return "no-trusted-client-ip";
  const value = request.headers.get(trustedIpHeader)?.trim();
  const address = z.union([z.ipv4(), z.ipv6()]).safeParse(value);
  return address.success ? address.data : "no-trusted-client-ip";
}
