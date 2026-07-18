import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnCollectionStickers } from "@/modules/collections";

import { apiError } from "../../../http";

const idSchema = z.uuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ collectionId: string }> },
): Promise<NextResponse> {
  const parsed = idSchema.safeParse((await context.params).collectionId);
  if (!parsed.success) return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  try {
    return NextResponse.json({ stickers: await getOwnCollectionStickers(request.headers, parsed.data) });
  } catch (error) {
    return apiError(error);
  }
}
