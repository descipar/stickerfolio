import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnTradeMatches, type TradeMatchOptions, type TradeMatchResult } from "@/modules/trading";

import { apiError } from "../../../http";

const idSchema = z.uuid();
const querySchema = z.object({
  direction: z.enum(["all", "one-way", "two-way"]).default("all"),
  section: z.union([z.uuid(), z.literal("")]).optional(),
  sort: z.enum(["compatibility", "offered", "wanted", "name"]).default("compatibility"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ collectionId: string }> },
): Promise<NextResponse> {
  return handleTradeMatchesRequest(request, (await context.params).collectionId);
}

export async function handleTradeMatchesRequest(
  request: Request,
  collectionIdValue: string,
  loadMatches: (
    headers: Headers,
    collectionId: string,
    options: TradeMatchOptions,
  ) => Promise<TradeMatchResult> = getOwnTradeMatches,
): Promise<NextResponse> {
  const collectionId = idSchema.safeParse(collectionIdValue);
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    direction: url.searchParams.get("direction") ?? undefined,
    section: url.searchParams.get("section") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!collectionId.success) return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  if (!parsedQuery.success) return NextResponse.json({ error: "Invalid trade filters." }, { status: 400 });
  try {
    return NextResponse.json(await loadMatches(request.headers, collectionId.data, {
      direction: parsedQuery.data.direction,
      ...(parsedQuery.data.section ? { sectionId: parsedQuery.data.section } : {}),
      sort: parsedQuery.data.sort,
      limit: parsedQuery.data.limit,
      offset: parsedQuery.data.offset,
    }));
  } catch (error) {
    return apiError(error);
  }
}
