import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { InMemoryFixedWindowRateLimiter } from "@/infrastructure/http";

import { handleAuthGet, handleAuthPost } from "./auth-gateway";

const subject = (email: string) => `subject(${email.length})`;

function signIn(email: string): Request {
  return new Request("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
}

function auditEvents(output: MockInstance) {
  return output.mock.calls
    .map(([line]) => JSON.parse(String(line)) as { event: string; audit?: Record<string, unknown> })
    .filter((entry) => entry.event === "security.audit")
    .map((entry) => entry.audit);
}

afterEach(() => vi.restoreAllMocks());

describe("sign-in limit per email address (#124)", () => {
  it("throttles one account after ten attempts without affecting other accounts", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const forward = vi.fn(async () => Response.json({ message: "Invalid email or password" }, { status: 401 }));
    const limiter = new InMemoryFixedWindowRateLimiter();

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const email = attempt % 2 ? "Victim@Example.test" : " victim@example.test ";
      const response = await handleAuthPost(signIn(email), forward, limiter, subject);
      expect(response.status).toBe(401);
    }
    const blocked = await handleAuthPost(signIn("victim@example.test"), forward, limiter, subject);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("x-retry-after"))).toBeGreaterThan(0);
    expect(forward).toHaveBeenCalledTimes(10);

    const other = await handleAuthPost(signIn("someone-else@example.test"), forward, limiter, subject);
    expect(other.status).toBe(401);
  });

  it("forwards sign-out untouched", async () => {
    const forward = vi.fn(async () => new Response(null, { status: 200 }));
    const limiter = new InMemoryFixedWindowRateLimiter();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await handleAuthPost(
        new Request("http://localhost/api/auth/sign-out", { method: "POST" }),
        forward,
        limiter,
        subject,
      );
      expect(response.status).toBe(200);
    }
  });
});

describe("exposed Better Auth endpoints (#128)", () => {
  const hiddenPost = [
    "/change-password",
    "/update-user",
    "/change-email",
    "/delete-user",
    "/revoke-session",
    "/revoke-sessions",
    "/revoke-other-sessions",
    "/sign-up/email",
    "/forget-password",
    "/request-password-reset",
    "/reset-password",
    "/set-password",
    "/sign-in/social",
    "/link-social",
    "/sign-in/email/",
    "/sign-in/email/extra",
  ];
  const hiddenGet = ["/list-sessions", "/list-accounts", "/ok", "/error", "/reset-password/token", "/get-session/x"];

  it.each(hiddenPost)("answers POST %s with 404 without reaching Better Auth", async (path) => {
    const forward = vi.fn(async () => new Response(null, { status: 200 }));
    const response = await handleAuthPost(
      new Request(`http://localhost/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: "x", currentPassword: "y", revokeOtherSessions: false }),
      }),
      forward,
      new InMemoryFixedWindowRateLimiter(),
      subject,
    );
    expect(response.status).toBe(404);
    expect(forward).not.toHaveBeenCalled();
  });

  it.each(hiddenGet)("answers GET %s with 404 without reaching Better Auth", async (path) => {
    const forward = vi.fn(async () => new Response(null, { status: 200 }));
    const response = await handleAuthGet(new Request(`http://localhost/api/auth${path}`), forward);
    expect(response.status).toBe(404);
    expect(forward).not.toHaveBeenCalled();
  });

  it("forwards get-session", async () => {
    const forward = vi.fn(async () => Response.json(null));
    const response = await handleAuthGet(new Request("http://localhost/api/auth/get-session"), forward);
    expect(response.status).toBe(200);
    expect(forward).toHaveBeenCalledOnce();
  });
});

describe("sign-in audit (#129)", () => {
  it("records failed and throttled sign-ins without the email address", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const limiter = new InMemoryFixedWindowRateLimiter();
    await handleAuthPost(signIn("victim@example.test"), async () => Response.json({}, { status: 401 }), limiter, subject);
    await handleAuthPost(signIn("victim@example.test"), async () => Response.json({}, { status: 429 }), limiter, subject);
    await handleAuthPost(signIn("ok@example.test"), async () => Response.json({}), limiter, subject);

    expect(auditEvents(output)).toEqual([
      expect.objectContaining({
        action: "auth.sign_in_failed",
        actorType: "system",
        targetType: "sign_in",
        targetId: "subject(19)",
        details: { status: 401 },
      }),
      expect.objectContaining({ action: "auth.sign_in_throttled", targetId: "subject(19)" }),
    ]);
    expect(JSON.stringify(output.mock.calls)).not.toContain("victim@example.test");
  });
});
