import { NextResponse } from "next/server";
import { z } from "zod";

import { updateAdminAlbumMetadata } from "@/modules/admin";

import { apiError } from "../../../http";

const idSchema = z.uuid();
const metadataSchema = z.object({
  revisionId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ albumId: string }> },
): Promise<NextResponse> {
  const albumId = idSchema.safeParse((await context.params).albumId);
  const metadata = metadataSchema.safeParse(await request.json().catch(() => null));
  if (!albumId.success || !metadata.success) {
    return NextResponse.json({ error: "Invalid album metadata." }, { status: 400 });
  }
  try {
    await updateAdminAlbumMetadata(
      request.headers,
      albumId.data,
      metadata.data.revisionId,
      { title: metadata.data.title, description: metadata.data.description },
    );
    return NextResponse.json({ updated: true });
  } catch (error) {
    return apiError(error);
  }
}
