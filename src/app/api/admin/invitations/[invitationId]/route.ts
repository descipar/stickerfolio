import { NextResponse } from "next/server";
import { z } from "zod";

import { revokeAdminInvitation } from "@/modules/admin";

import { apiError } from "../../../http";

const idSchema = z.uuid();

export async function DELETE(
  request: Request,
  context: { params: Promise<{ invitationId: string }> },
): Promise<NextResponse> {
  const id = idSchema.safeParse((await context.params).invitationId);
  if (!id.success) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  try {
    await revokeAdminInvitation(request.headers, id.data);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return apiError(error);
  }
}
