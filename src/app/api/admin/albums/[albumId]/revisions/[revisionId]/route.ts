import { NextResponse } from "next/server";
import { z } from "zod";

import { setAdminRevisionStatus } from "@/modules/admin";

import { apiError } from "../../../../../http";

const idSchema = z.uuid();
const mutationSchema = z.object({ action: z.enum(["publish", "archive"]) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ albumId: string; revisionId: string }> },
): Promise<NextResponse> {
  const params = await context.params;
  const albumId = idSchema.safeParse(params.albumId);
  const revisionId = idSchema.safeParse(params.revisionId);
  const mutation = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!albumId.success || !revisionId.success || !mutation.success) {
    return NextResponse.json({ error: "Invalid revision update." }, { status: 400 });
  }
  try {
    await setAdminRevisionStatus(request.headers, revisionId.data, mutation.data.action);
    return NextResponse.json({ updated: true });
  } catch (error) {
    return apiError(error);
  }
}
