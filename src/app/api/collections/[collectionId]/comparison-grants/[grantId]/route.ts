import { NextResponse } from "next/server";
import { z } from "zod";

import { revokeOwnComparisonGrant } from "@/modules/trading";

import { apiError } from "../../../../http";

const idSchema = z.uuid();
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function DELETE(
  request: Request,
  context: { params: Promise<{ collectionId: string; grantId: string }> },
): Promise<NextResponse> {
  const params = await context.params;
  const collectionId = idSchema.safeParse(params.collectionId);
  const grantId = idSchema.safeParse(params.grantId);
  if (!collectionId.success || !grantId.success) {
    return NextResponse.json({ error: "Comparison unavailable." }, { status: 404 });
  }
  try {
    const revoked = await revokeOwnComparisonGrant(
      request.headers,
      collectionId.data,
      grantId.data,
    );
    return revoked
      ? new NextResponse(null, { status: 204, headers: privateHeaders })
      : NextResponse.json({ error: "Comparison unavailable." }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
}
