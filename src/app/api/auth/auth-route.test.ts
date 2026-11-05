import { describe, expect, it, vi } from "vitest";

import { InMemoryFixedWindowRateLimiter } from "@/infrastructure/http";

import { handleAuthPost } from "./[...all]/route";

function signIn(email: string): Request {
  return new Request("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
}

describe("sign-in limit per email address (#124)", () => {
  it("throttles one account after ten attempts without affecting other accounts", async () => {
    const forward = vi.fn(async () => Response.json({ message: "Invalid email or password" }, { status: 401 }));
    const limiter = new InMemoryFixedWindowRateLimiter();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await handleAuthPost(signIn(attempt % 2 ? "Victim@Example.test" : " victim@example.test "), forward, limiter);
      expect(response.status).toBe(401);
    }
    const blocked = await handleAuthPost(signIn("victim@example.test"), forward, limiter);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("x-retry-after"))).toBeGreaterThan(0);
    expect(forward).toHaveBeenCalledTimes(10);

    const other = await handleAuthPost(signIn("someone-else@example.test"), forward, limiter);
    expect(other.status).toBe(401);
  });

  it("forwards other auth requests untouched", async () => {
    const forward = vi.fn(async () => new Response(null, { status: 200 }));
    const limiter = new InMemoryFixedWindowRateLimiter();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await handleAuthPost(
        new Request("http://localhost/api/auth/sign-out", { method: "POST" }),
        forward,
        limiter,
      );
      expect(response.status).toBe(200);
    }
  });
});
