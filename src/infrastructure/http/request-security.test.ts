import { describe, expect, it } from "vitest";

import {
  clientAddressHeader,
  getAuthenticatedRateLimitKey,
  getRateLimitClientKey,
  InMemoryFixedWindowRateLimiter,
  isUnsafeCrossOriginRequest,
  resolveClientAddressHeader,
  sharedClientKey,
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

  it("bounds memory by sweeping expired windows and dropping the oldest active one", () => {
    const limiter = new InMemoryFixedWindowRateLimiter(3);
    limiter.consume("a", 5, 1_000, 0);
    limiter.consume("b", 5, 1_000, 0);
    limiter.consume("c", 5, 60_000, 0);
    expect(limiter.size).toBe(3);

    // a and b expired: both are swept, so the active window c survives.
    limiter.consume("d", 5, 60_000, 2_000);
    expect(limiter.size).toBe(2);
    limiter.consume("e", 5, 60_000, 2_000);
    expect(limiter.size).toBe(3);

    // All active: the oldest window (c) is dropped instead of growing.
    limiter.consume("f", 5, 60_000, 3_000);
    expect(limiter.size).toBe(3);
    for (let key = 0; key < 1_000; key += 1) limiter.consume(`k${key}`, 5, 60_000, 4_000);
    expect(limiter.size).toBe(3);
  });

  it("keeps an existing exhausted window while other keys arrive", () => {
    const limiter = new InMemoryFixedWindowRateLimiter(2);
    limiter.consume("noisy", 1, 60_000, 0);
    expect(limiter.consume("noisy", 1, 60_000, 1).allowed).toBe(false);
    limiter.consume("other", 1, 60_000, 2);
    expect(limiter.consume("noisy", 1, 60_000, 3).allowed).toBe(false);
  });

  it("ignores spoofable forwarding headers unless one is explicitly trusted", () => {
    const request = new Request("https://stickers.example.test/api/register/invitation", {
      headers: { "x-forwarded-for": "203.0.113.10", "x-real-ip": "192.0.2.20" },
    });
    expect(getRateLimitClientKey(request, undefined, false)).toBe(sharedClientKey);
    expect(getRateLimitClientKey(request, "x-real-ip", false)).toBe("192.0.2.20");
    expect(
      getRateLimitClientKey(
        new Request("https://stickers.example.test", {
          headers: { "x-real-ip": "not-an-ip" },
        }),
        "x-real-ip",
        false,
      ),
    ).toBe(sharedClientKey);
  });

  it("keys clients by the preload-recorded socket address when no proxy header is trusted", () => {
    const first = new Request("https://stickers.example.test", {
      headers: { [clientAddressHeader]: "198.51.100.1", "x-forwarded-for": "203.0.113.10" },
    });
    const second = new Request("https://stickers.example.test", {
      headers: { [clientAddressHeader]: "198.51.100.2" },
    });
    expect(getRateLimitClientKey(first, undefined, true)).toBe("198.51.100.1");
    expect(getRateLimitClientKey(second, undefined, true)).toBe("198.51.100.2");
    // Without the preload the header could be client-supplied and is ignored.
    expect(getRateLimitClientKey(first, undefined, false)).toBe(sharedClientKey);
    // An operator-configured proxy header always takes precedence.
    expect(resolveClientAddressHeader("x-real-ip", true)).toBe("x-real-ip");
    expect(resolveClientAddressHeader(undefined, true)).toBe(clientAddressHeader);
    expect(resolveClientAddressHeader(undefined, false)).toBeUndefined();
  });

  it("keys authenticated requests by session rather than by client address", () => {
    const sameClient = { [clientAddressHeader]: "198.51.100.1" };
    const alice = new Request("https://stickers.example.test", {
      headers: { ...sameClient, cookie: "theme=dark; better-auth.session_token=alice-token.sig" },
    });
    const bob = new Request("https://stickers.example.test", {
      headers: { ...sameClient, cookie: "__Secure-better-auth.session_token=bob-token.sig" },
    });
    const anonymous = new Request("https://stickers.example.test", { headers: sameClient });
    const aliceKey = getAuthenticatedRateLimitKey(alice, undefined, true);
    expect(aliceKey).toMatch(/^session:[0-9a-f]{64}$/);
    expect(aliceKey).not.toContain("alice-token");
    expect(getAuthenticatedRateLimitKey(bob, undefined, true)).not.toBe(aliceKey);
    expect(getAuthenticatedRateLimitKey(anonymous, undefined, true)).toBe("client:198.51.100.1");
  });
});
