import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";

import { getEnvironment } from "@/infrastructure/config";
import { getAuthenticatedRateLimitKey, InMemoryFixedWindowRateLimiter } from "@/infrastructure/http";
import {
  createOwnComparisonGrant,
  getOwnComparisonGrants,
} from "@/modules/trading";

import { apiError } from "../../../http";

const idSchema = z.uuid();
const privateHeaders = { "Cache-Control": "private, no-store" };
// #133: at most ten new comparison codes per session and ten minutes.
const grantCreationLimiter = new InMemoryFixedWindowRateLimiter();
const grantCreationMaximum = 10;
const grantCreationWindowMs = 10 * 60_000;

export async function GET(
  request: Request,
  context: { params: Promise<{ collectionId: string }> },
): Promise<NextResponse> {
  const collectionId = idSchema.safeParse((await context.params).collectionId);
  if (!collectionId.success) {
    return NextResponse.json({ error: "Comparison unavailable." }, { status: 404 });
  }
  try {
    const grants = await getOwnComparisonGrants(request.headers, collectionId.data);
    return NextResponse.json({ grants }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error, request);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ collectionId: string }> },
): Promise<NextResponse> {
  const collectionId = idSchema.safeParse((await context.params).collectionId);
  if (!collectionId.success) {
    return NextResponse.json({ error: "Comparison unavailable." }, { status: 404 });
  }
  const decision = grantCreationLimiter.consume(
    `comparison-grant:${getAuthenticatedRateLimitKey(request, getEnvironment().auth.trustedIpHeader)}`,
    grantCreationMaximum,
    grantCreationWindowMs,
  );
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many comparison codes. Please try again later." },
      { status: 429, headers: { ...privateHeaders, "Retry-After": String(decision.retryAfterSeconds) } },
    );
  }
  try {
    const created = await createOwnComparisonGrant(request.headers, collectionId.data);
    const url = new URL(`/compare/${created.token}`, getEnvironment().appBaseUrl).toString();
    const qrDataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
    });
    return NextResponse.json(
      { grant: created.grant, code: created.code, url, qrDataUrl },
      { status: 201, headers: privateHeaders },
    );
  } catch (error) {
    return apiError(error, request);
  }
}
