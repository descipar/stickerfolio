import { NextResponse } from "next/server";
import { z } from "zod";

import { getEnvironment } from "@/infrastructure/config";
import { readLimitedJson } from "@/infrastructure/http";
import {
  collectionShareScopes,
  createOwnCollectionShare,
  getOwnCollectionShares,
} from "@/modules/collections";

import { apiError, requestBodyTooLarge } from "../../../http";

const idSchema = z.uuid();
const createSchema = z.object({
  scope: z.enum(collectionShareScopes),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(
  request: Request,
  context: { params: Promise<{ collectionId: string }> },
): Promise<NextResponse> {
  const collectionId = idSchema.safeParse((await context.params).collectionId);
  if (!collectionId.success) {
    return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  }
  try {
    const shares = await getOwnCollectionShares(request.headers, collectionId.data);
    return NextResponse.json(
      {
        shares,
        sharingEnabled: getEnvironment().publicShareBaseUrl !== null,
      },
      { headers: privateHeaders },
    );
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
    return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  }
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = createSchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) {
    return NextResponse.json({ error: "Invalid share settings." }, { status: 400 });
  }

  try {
    const publicShareBaseUrl = getEnvironment().publicShareBaseUrl;
    if (!publicShareBaseUrl) {
      return NextResponse.json(
        {
          error: "Sharing is disabled until PUBLIC_SHARE_BASE_URL is configured.",
        },
        { status: 409, headers: privateHeaders },
      );
    }
    const created = await createOwnCollectionShare(
      request.headers,
      collectionId.data,
      body.data.scope,
      body.data.expiresAt ? new Date(body.data.expiresAt) : null,
    );
    const url = new URL(
      `/share/${created.token}`,
      publicShareBaseUrl,
    ).toString();
    return NextResponse.json(
      { share: created.share, url },
      { status: 201, headers: privateHeaders },
    );
  } catch (error) {
    return apiError(error);
  }
}
