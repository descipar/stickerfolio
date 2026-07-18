import { NextResponse } from "next/server";
import { z } from "zod";

import { removeOwnCollection } from "@/modules/collections";

import { apiError } from "../../http";

const idSchema = z.uuid();

export async function DELETE(
  request: Request,
  context: { params: Promise<{ collectionId: string }> },
): Promise<NextResponse> {
  const parsed = idSchema.safeParse((await context.params).collectionId);
  if (!parsed.success) return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  try {
    const removed = await removeOwnCollection(request.headers, parsed.data);
    return removed
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: "Collection not found." }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
}
