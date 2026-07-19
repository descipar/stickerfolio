import { toNextJsHandler } from "better-auth/next-js";

import { cloneWithLimitedBody } from "@/infrastructure/http";
import { getAuth } from "@/modules/identity";

const handlers = toNextJsHandler(getAuth());

export const GET = handlers.GET;

export async function POST(request: Request): Promise<Response> {
  const limitedRequest = await cloneWithLimitedBody(request);
  if (limitedRequest.status === "too-large") {
    return Response.json({ error: "Request body is too large." }, { status: 413 });
  }
  if (limitedRequest.status === "invalid") {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  return handlers.POST(limitedRequest.value);
}
