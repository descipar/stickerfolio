import { NextResponse } from "next/server";
import { z } from "zod";

import { getEnvironment } from "@/infrastructure/config";
import {
  getRateLimitClientKey,
  InMemoryFixedWindowRateLimiter,
  readLimitedJson,
} from "@/infrastructure/http";
import { getOwnComparisonSetup } from "@/modules/trading";

import { apiError, requestBodyTooLarge } from "../../http";

const credentialSchema = z
  .object({
    token: z.string().max(128).optional(),
    code: z.string().max(32).optional(),
  })
  .refine((value) => (value.token === undefined) !== (value.code === undefined));
const limiter = new InMemoryFixedWindowRateLimiter();
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function handleComparisonSetupRequest(
  request: Request,
  loadSetup: typeof getOwnComparisonSetup = getOwnComparisonSetup,
  trustedIpHeader?: string,
): Promise<NextResponse> {
  const key = getRateLimitClientKey(request, trustedIpHeader);
  const decision = limiter.consume(`comparison-setup:${key}`, 30, 60_000);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { ...privateHeaders, "retry-after": String(decision.retryAfterSeconds) } },
    );
  }
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = credentialSchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) {
    return NextResponse.json({ error: "Comparison unavailable." }, { status: 404 });
  }
  try {
    const setup = await loadSetup(request.headers, body.data);
    return NextResponse.json({ setup }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleComparisonSetupRequest(
    request,
    getOwnComparisonSetup,
    getEnvironment().auth.trustedIpHeader,
  );
}
