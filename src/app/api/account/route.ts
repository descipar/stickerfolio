import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import { deleteOwnAccount, loginEmailSchema } from "@/modules/identity";

import { apiError, requestBodyTooLarge } from "../http";

// Permanent, irreversible self-service deletion. The current password and the
// exact login email are both required and verified server-side; the client
// confirmation is never trusted on its own.
const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  confirmationEmail: loginEmailSchema,
});

export async function DELETE(request: Request): Promise<NextResponse> {
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = bodySchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) return NextResponse.json({ error: "Invalid confirmation." }, { status: 400 });
  try {
    await deleteOwnAccount(request.headers, body.data.currentPassword, body.data.confirmationEmail);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
