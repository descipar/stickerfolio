import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import { changeOwnEmail, loginEmailSchema } from "@/modules/identity";

import { apiError, requestBodyTooLarge } from "../../http";

const bodySchema = z.object({
  email: loginEmailSchema,
  currentPassword: z.string().min(1).max(128),
});

export async function PATCH(request: Request): Promise<NextResponse> {
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = bodySchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) return NextResponse.json({ error: "Invalid account details." }, { status: 400 });
  try {
    await changeOwnEmail(request.headers, body.data.email, body.data.currentPassword);
    return NextResponse.json({ updated: true });
  } catch (error) {
    return apiError(error);
  }
}
