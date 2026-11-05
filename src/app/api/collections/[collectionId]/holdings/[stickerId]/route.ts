import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import { changeOwnHoldingQuantity, HoldingConflictError, type HoldingChange } from "@/modules/collections";

import { apiError, requestBodyTooLarge } from "../../../../http";

const paramsSchema = z.object({ collectionId: z.uuid(), stickerId: z.uuid() });
const quantity = z.number().int().min(0).max(99);
// Either a relative change (`delta`) or an absolute `quantity`, optionally
// guarded by the `expectedQuantity` the client last saw (#127).
const bodySchema = z.union([
  z.object({ delta: z.number().int().min(-99).max(99).refine((value) => value !== 0) }).strict(),
  z.object({ quantity, expectedQuantity: quantity.optional() }).strict(),
]);

function toChange(body: z.infer<typeof bodySchema>): HoldingChange {
  return "delta" in body
    ? { type: "add", delta: body.delta }
    : { type: "set", quantity: body.quantity, expectedQuantity: body.expectedQuantity };
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ collectionId: string; stickerId: string }> },
): Promise<NextResponse> {
  const params = paramsSchema.safeParse(await context.params);
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = bodySchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!params.success || !body.success) {
    return NextResponse.json({ error: "Invalid holding update." }, { status: 400 });
  }
  try {
    const result = await changeOwnHoldingQuantity(
      request.headers,
      params.data.collectionId,
      params.data.stickerId,
      toChange(body.data),
    );
    return NextResponse.json({ quantity: result });
  } catch (error) {
    if (error instanceof HoldingConflictError) {
      return NextResponse.json(
        { error: error.message, quantity: error.currentQuantity },
        { status: 409 },
      );
    }
    return apiError(error, request);
  }
}
