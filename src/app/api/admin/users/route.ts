import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import { createManagedUser, listManagedUsers } from "@/modules/admin";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

import { apiError, requestBodyTooLarge } from "../../http";

const createSchema = z.object({
  email: z.email().max(254),
  displayName: z.string().trim().min(1).max(100),
  initialPassword: z.string().min(minimumPasswordLength).max(maximumPasswordLength),
  role: z.enum(["user", "admin"]).default("user"),
});

export async function GET(request: Request): Promise<NextResponse> {
  try {
    return NextResponse.json({ users: await listManagedUsers(request.headers) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = createSchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) return NextResponse.json({ error: "Invalid account details." }, { status: 400 });
  try {
    return NextResponse.json(
      await createManagedUser(request.headers, body.data),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
