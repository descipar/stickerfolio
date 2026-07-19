import { describe, expect, it } from "vitest";

import {
  getRateLimitClientKey,
  InMemoryFixedWindowRateLimiter,
  isUnsafeCrossOriginRequest,
} from "./request-security";

describe("state-changing request origin policy", () => {
  const appOrigin = "https://stickers.example.test";

  it("rejects cross-origin and cross-site mutations", () => {
    expect(
      isUnsafeCrossOriginRequest(
        new Request(`${appOrigin}/api/collections`, {
          method: "POST",
          headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
        }),
        appOrigin,
      ),
    ).toBe(true);
  });

  it("allows same-origin mutations and safe cross-origin reads", () => {
    expect(
      isUnsafeCrossOriginRequest(
        new Request(`${appOrigin}/api/collections`, {
          method: "POST",
          headers: { origin: appOrigin, "sec-fetch-site": "same-origin" },
        }),
        appOrigin,
      ),
    ).toBe(false);
    expect(
      isUnsafeCrossOriginRequest(
        new Request(`${appOrigin}/api/collections`, {
          headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
        }),
        appOrigin,
      ),
    ).toBe(false);
  });
});

describe("sensitive endpoint rate-limit policy", () => {
  it("throttles the sixth attempt and resets after the window", () => {
    const limiter = new InMemoryFixedWindowRateLimiter();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.consume("client", 5, 60_000, 1_000).allowed).toBe(true);
    }
    expect(limiter.consume("client", 5, 60_000, 1_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    expect(limiter.consume("client", 5, 60_000, 61_000).allowed).toBe(true);
  });

  it("ignores spoofable forwarding headers unless one is explicitly trusted", () => {
    const request = new Request("https://stickers.example.test/api/invitations/redeem", {
      headers: { "x-forwarded-for": "203.0.113.10", "x-real-ip": "192.0.2.20" },
    });
    expect(getRateLimitClientKey(request)).toBe("no-trusted-client-ip");
    expect(getRateLimitClientKey(request, "x-real-ip")).toBe("192.0.2.20");
    expect(
      getRateLimitClientKey(
        new Request("https://stickers.example.test", {
          headers: { "x-real-ip": "not-an-ip" },
        }),
        "x-real-ip",
      ),
    ).toBe("no-trusted-client-ip");
  });
});
