import { NextResponse } from "next/server";
import { z } from "zod";

import { getEnvironment } from "@/infrastructure/config";
import {
  InMemoryFixedWindowRateLimiter,
  getRateLimitClientKey,
  readLimitedJson,
} from "@/infrastructure/http";
import { acceptInvitation, findValidInvitationByToken } from "@/modules/identity";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

import { apiError, requestBodyTooLarge } from "../../http";

const tokenSchema = z.string().min(1).max(512);
const acceptSchema = z.object({
  token: tokenSchema,
  password: z.string().min(minimumPasswordLength).max(maximumPasswordLength),
  displayName: z.string().trim().min(1).max(100).optional(),
});

const limiter = new InMemoryFixedWindowRateLimiter();

export async function GET(request: Request): Promise<NextResponse> {
  const token = tokenSchema.safeParse(new URL(request.url).searchParams.get("token") ?? "");
  if (!token.success) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  try {
    const invitation = await findValidInvitationByToken(token.data);
    if (!invitation) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    return NextResponse.json(invitation);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const key = getRateLimitClientKey(request, getEnvironment().auth.trustedIpHeader);
  const decision = limiter.consume(`register-invitation:${key}`, 10, 60_000);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
    );
  }
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = acceptSchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) return NextResponse.json({ error: "Invalid invitation details." }, { status: 400 });
  try {
    const result = await acceptInvitation(body.data);
    return NextResponse.json({ email: result.email }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
