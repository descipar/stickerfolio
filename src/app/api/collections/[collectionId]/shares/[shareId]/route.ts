import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import {
  collectionShareScopes,
  revokeOwnCollectionShare,
  updateOwnCollectionShare,
} from "@/modules/collections";

import { apiError, requestBodyTooLarge } from "../../../../http";

const idSchema = z.uuid();
const updateSchema = z
  .object({
    scope: z.enum(collectionShareScopes).optional(),
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine((value) => value.scope !== undefined || value.expiresAt !== undefined);
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function PATCH(
  request: Request,
  context: { params: Promise<{ collectionId: string; shareId: string }> },
): Promise<NextResponse> {
  const params = await context.params;
  const collectionId = idSchema.safeParse(params.collectionId);
  const shareId = idSchema.safeParse(params.shareId);
  if (!collectionId.success || !shareId.success) {
    return NextResponse.json({ error: "Share link not found." }, { status: 404 });
  }
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = updateSchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) {
    return NextResponse.json({ error: "Invalid share settings." }, { status: 400 });
  }

  try {
    const share = await updateOwnCollectionShare(
      request.headers,
      collectionId.data,
      shareId.data,
      {
        ...(body.data.scope ? { scope: body.data.scope } : {}),
        ...(body.data.expiresAt !== undefined
          ? { expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null }
          : {}),
      },
    );
    return NextResponse.json({ share }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ collectionId: string; shareId: string }> },
): Promise<NextResponse> {
  const params = await context.params;
  const collectionId = idSchema.safeParse(params.collectionId);
  const shareId = idSchema.safeParse(params.shareId);
  if (!collectionId.success || !shareId.success) {
    return NextResponse.json({ error: "Share link not found." }, { status: 404 });
  }
  try {
    const revoked = await revokeOwnCollectionShare(
      request.headers,
      collectionId.data,
      shareId.data,
    );
    return revoked
      ? new NextResponse(null, { status: 204, headers: privateHeaders })
      : NextResponse.json({ error: "Share link not found." }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
}
