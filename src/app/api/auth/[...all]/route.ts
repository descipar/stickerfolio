import { toNextJsHandler } from "better-auth/next-js";

import { cloneWithLimitedBody, InMemoryFixedWindowRateLimiter } from "@/infrastructure/http";
import { getAuth, normalizeEmail } from "@/modules/identity";

let handlers: ReturnType<typeof toNextJsHandler> | undefined;
function authHandlers(): ReturnType<typeof toNextJsHandler> {
  handlers ??= toNextJsHandler(getAuth());
  return handlers;
}

export async function GET(request: Request): Promise<Response> {
  return authHandlers().GET(request);
}

// Better Auth limits sign-in per client address. This additional limit per
// normalized email address stops a distributed guessing attack against one
// account without letting a single client lock out everyone (#124).
const signInEmailWindowMs = 10 * 60_000;
const signInEmailMaximum = 10;
const defaultSignInEmailLimiter = new InMemoryFixedWindowRateLimiter();

async function signInEmailKey(request: Request): Promise<string | null> {
  if (!new URL(request.url).pathname.endsWith("/sign-in/email")) return null;
  try {
    const body: unknown = await request.clone().json();
    const email = typeof body === "object" && body !== null ? (body as { email?: unknown }).email : undefined;
    return typeof email === "string" && email.trim() ? `sign-in-email:${normalizeEmail(email)}` : null;
  } catch {
    return null;
  }
}

export async function handleAuthPost(
  request: Request,
  forward: (request: Request) => Promise<Response> = (forwarded) => authHandlers().POST(forwarded),
  signInEmailLimiter: InMemoryFixedWindowRateLimiter = defaultSignInEmailLimiter,
): Promise<Response> {
  const limitedRequest = await cloneWithLimitedBody(request);
  if (limitedRequest.status === "too-large") {
    return Response.json({ error: "Request body is too large." }, { status: 413 });
  }
  if (limitedRequest.status === "invalid") {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const key = await signInEmailKey(limitedRequest.value);
  if (key) {
    const decision = signInEmailLimiter.consume(key, signInEmailMaximum, signInEmailWindowMs);
    if (!decision.allowed) {
      return Response.json(
        { message: "Too many requests. Please try again later." },
        { status: 429, headers: { "X-Retry-After": String(decision.retryAfterSeconds) } },
      );
    }
  }
  return forward(limitedRequest.value);
}

export async function POST(request: Request): Promise<Response> {
  return handleAuthPost(request);
}
