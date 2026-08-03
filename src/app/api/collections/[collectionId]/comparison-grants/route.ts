import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { z } from "zod";

import { getEnvironment } from "@/infrastructure/config";
import {
  createOwnComparisonGrant,
  getOwnComparisonGrants,
} from "@/modules/trading";

import { apiError } from "../../../http";

const idSchema = z.uuid();
const privateHeaders = { "Cache-Control": "private, no-store" };

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
    return apiError(error);
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
    return apiError(error);
  }
}
