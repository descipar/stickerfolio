import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import { addOwnCollection, getCollectionsOverview } from "@/modules/collections";

import { apiError, requestBodyTooLarge } from "../http";

const createSchema = z.object({ albumId: z.uuid() });

export async function GET(request: Request): Promise<NextResponse> {
  try {
    return NextResponse.json(await getCollectionsOverview(request.headers));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = createSchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) return NextResponse.json({ error: "Invalid album." }, { status: 400 });
  try {
    const collection = await addOwnCollection(request.headers, body.data.albumId);
    return NextResponse.json(collection, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
