import { NextResponse } from "next/server";
import { z } from "zod";

import { getEnvironment } from "@/infrastructure/config";
import {
  InMemoryFixedWindowRateLimiter,
  getRateLimitClientKey,
  readLimitedJson,
} from "@/infrastructure/http";
import { loginEmailSchema, registerOpenAccount } from "@/modules/identity";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

import { apiError, requestBodyTooLarge } from "../../http";

const schema = z.object({
  email: loginEmailSchema,
  password: z.string().min(minimumPasswordLength).max(maximumPasswordLength),
  displayName: z.string().trim().min(1).max(100),
});

// Per-process fixed-window limiter (MVP single instance; see Roadmap 10.2).
const limiter = new InMemoryFixedWindowRateLimiter();

export async function POST(request: Request): Promise<NextResponse> {
  const key = getRateLimitClientKey(request, getEnvironment().auth.trustedIpHeader);
  const decision = limiter.consume(`register-open:${key}`, 10, 60_000);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
    );
  }
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = schema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) return NextResponse.json({ error: "Invalid registration details." }, { status: 400 });
  try {
    await registerOpenAccount(body.data);
    return NextResponse.json({ registered: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
