import { NextResponse } from "next/server";
import { z } from "zod";

import { setOwnHoldingQuantity } from "@/modules/collections";

import { apiError } from "../../../../http";

const paramsSchema = z.object({ collectionId: z.uuid(), stickerId: z.uuid() });
const bodySchema = z.object({ quantity: z.number().int().min(0).max(99) });

export async function PUT(
  request: Request,
  context: { params: Promise<{ collectionId: string; stickerId: string }> },
): Promise<NextResponse> {
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !body.success) {
    return NextResponse.json({ error: "Invalid holding update." }, { status: 400 });
  }
  try {
    await setOwnHoldingQuantity(
      request.headers,
      params.data.collectionId,
      params.data.stickerId,
      body.data.quantity,
    );
    return NextResponse.json({ quantity: body.data.quantity });
  } catch (error) {
    return apiError(error);
  }
}
