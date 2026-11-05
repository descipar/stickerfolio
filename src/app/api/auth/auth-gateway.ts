import { createHmac } from "node:crypto";

import { getEnvironment } from "@/infrastructure/config";
import { cloneWithLimitedBody, type InMemoryFixedWindowRateLimiter } from "@/infrastructure/http";
import { writeAuditEvent } from "@/infrastructure/observability";
import { normalizeEmail } from "@/modules/identity";

const authBasePath = "/api/auth";

/**
 * The only Better Auth endpoints reachable over HTTP (#128). Every other
 * default endpoint (change-password, update-user, list/revoke-sessions, ...)
 * answers 404, so security-relevant flows run only through the application's
 * own use cases. Server-side `auth.api.*` calls are unaffected.
 */
export const exposedAuthEndpoints = {
  GET: new Set(["/get-session"]),
  POST: new Set(["/sign-in/email", "/sign-out"]),
} as const;

function authPath(request: Request): string | null {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith(`${authBasePath}/`) ? pathname.slice(authBasePath.length) : null;
}

export function isExposedAuthEndpoint(method: "GET" | "POST", request: Request): boolean {
  const path = authPath(request);
  return path !== null && exposedAuthEndpoints[method].has(path);
}

function notFound(): Response {
  return Response.json({ error: "Not found." }, { status: 404 });
}

type Forward = (request: Request) => Promise<Response>;

export async function handleAuthGet(request: Request, forward: Forward): Promise<Response> {
  if (!isExposedAuthEndpoint("GET", request)) return notFound();
  return forward(request);
}

// Better Auth limits sign-in per client address. This additional limit per
// normalized email address stops a distributed guessing attack against one
// account without letting a single client lock out everyone (#124).
const signInEmailWindowMs = 10 * 60_000;
const signInEmailMaximum = 10;

async function signInEmail(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.clone().json();
    const email = typeof body === "object" && body !== null ? (body as { email?: unknown }).email : undefined;
    return typeof email === "string" && email.trim() ? normalizeEmail(email) : null;
  } catch {
    return null;
  }
}

/**
 * Pseudonymous, keyed identifier for audit events about sign-in attempts. It
 * correlates attempts against one address without recording the address (#129).
 */
export function defaultSignInSubject(email: string): string {
  return createHmac("sha256", getEnvironment().auth.secret)
    .update(`sign-in-subject:${email}`)
    .digest("hex")
    .slice(0, 32);
}

function auditSignIn(
  outcome: "failed" | "throttled",
  email: string | null,
  status: number,
  subject: (email: string) => string,
): void {
  writeAuditEvent(
    outcome === "failed" ? "auth.sign_in_failed" : "auth.sign_in_throttled",
    { type: "system" },
    { type: "sign_in", id: email ? subject(email) : "unknown" },
    { status },
  );
}

export async function handleAuthPost(
  request: Request,
  forward: Forward,
  signInEmailLimiter: InMemoryFixedWindowRateLimiter,
  signInSubject: (email: string) => string,
): Promise<Response> {
  if (!isExposedAuthEndpoint("POST", request)) return notFound();
  const limitedRequest = await cloneWithLimitedBody(request);
  if (limitedRequest.status === "too-large") {
    return Response.json({ error: "Request body is too large." }, { status: 413 });
  }
  if (limitedRequest.status === "invalid") {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const isSignIn = authPath(limitedRequest.value) === "/sign-in/email";
  const email = isSignIn ? await signInEmail(limitedRequest.value) : null;
  if (email) {
    const decision = signInEmailLimiter.consume(
      `sign-in-email:${email}`,
      signInEmailMaximum,
      signInEmailWindowMs,
    );
    if (!decision.allowed) {
      auditSignIn("throttled", email, 429, signInSubject);
      return Response.json(
        { message: "Too many requests. Please try again later." },
        { status: 429, headers: { "X-Retry-After": String(decision.retryAfterSeconds) } },
      );
    }
  }

  const response = await forward(limitedRequest.value);
  if (isSignIn && response.status === 429) {
    auditSignIn("throttled", email, 429, signInSubject);
  } else if (isSignIn && response.status >= 400) {
    auditSignIn("failed", email, response.status, signInSubject);
  }
  return response;
}
