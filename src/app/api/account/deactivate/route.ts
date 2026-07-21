import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import { deactivateOwnAccount } from "@/modules/identity";

import { apiError, requestBodyTooLarge } from "../../http";

// Reversible self-service deactivation. Requires the current password so the
// action is deliberate; revokes every active session on success.
const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
});

export async function POST(request: Request): Promise<NextResponse> {
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = bodySchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) return NextResponse.json({ error: "Invalid confirmation." }, { status: 400 });
  try {
    await deactivateOwnAccount(request.headers, body.data.currentPassword);
    return NextResponse.json({ deactivated: true });
  } catch (error) {
    return apiError(error);
  }
}
