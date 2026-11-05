import { toNextJsHandler } from "better-auth/next-js";

import { InMemoryFixedWindowRateLimiter } from "@/infrastructure/http";
import { getAuth } from "@/auth";

import {
  defaultSignInSubject,
  handleAuthGet as handleGet,
  handleAuthPost as handlePost,
} from "../auth-gateway";

let handlers: ReturnType<typeof toNextJsHandler> | undefined;
function authHandlers(): ReturnType<typeof toNextJsHandler> {
  handlers ??= toNextJsHandler(getAuth());
  return handlers;
}

const signInEmailLimiter = new InMemoryFixedWindowRateLimiter();

export async function GET(request: Request): Promise<Response> {
  return handleGet(request, (forwarded) => authHandlers().GET(forwarded));
}

export async function POST(request: Request): Promise<Response> {
  return handlePost(
    request,
    (forwarded) => authHandlers().POST(forwarded),
    signInEmailLimiter,
    defaultSignInSubject,
  );
}
