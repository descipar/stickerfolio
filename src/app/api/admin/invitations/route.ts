import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import { createAdminInvitation, listAdminInvitations } from "@/modules/admin";
import { loginEmailSchema } from "@/modules/identity";

import { apiError, requestBodyTooLarge } from "../../http";

const createSchema = z.object({
  email: loginEmailSchema,
  displayName: z.string().trim().min(1).max(100).optional(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  try {
    return NextResponse.json({ invitations: await listAdminInvitations(request.headers) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = createSchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) return NextResponse.json({ error: "Invalid invitation details." }, { status: 400 });
  try {
    return NextResponse.json(await createAdminInvitation(request.headers, body.data), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
