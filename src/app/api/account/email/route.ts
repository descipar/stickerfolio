import { NextResponse } from "next/server";
import { z } from "zod";

import { changeOwnEmail } from "@/modules/identity";

import { apiError } from "../../http";

const bodySchema = z.object({
  email: z.email().max(254),
  currentPassword: z.string().min(1).max(128),
});

export async function PATCH(request: Request): Promise<NextResponse> {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid account details." }, { status: 400 });
  try {
    await changeOwnEmail(request.headers, body.data.email, body.data.currentPassword);
    return NextResponse.json({ updated: true });
  } catch (error) {
    return apiError(error);
  }
}
