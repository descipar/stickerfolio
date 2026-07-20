import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import {
  deleteManagedUser,
  resetManagedUserPassword,
  setManagedUserEmail,
  setManagedUserRole,
  setManagedUserStatus,
} from "@/modules/admin";
import { loginEmailSchema } from "@/modules/identity";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

import { apiError, requestBodyTooLarge } from "../../../http";

const idSchema = z.uuid();
const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), status: z.enum(["active", "suspended"]) }),
  z.object({ action: z.literal("role"), role: z.enum(["user", "admin"]) }),
  z.object({
    action: z.literal("email"),
    email: loginEmailSchema,
  }),
  z.object({
    action: z.literal("reset-password"),
    password: z.string().min(minimumPasswordLength).max(maximumPasswordLength),
  }),
]);
const deleteSchema = z.object({ confirmationEmail: loginEmailSchema });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const userId = idSchema.safeParse((await context.params).userId);
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const mutation = mutationSchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!userId.success || !mutation.success) {
    return NextResponse.json({ error: "Invalid user update." }, { status: 400 });
  }
  try {
    if (mutation.data.action === "status") {
      await setManagedUserStatus(request.headers, userId.data, mutation.data.status);
    } else if (mutation.data.action === "role") {
      await setManagedUserRole(request.headers, userId.data, mutation.data.role);
    } else if (mutation.data.action === "email") {
      await setManagedUserEmail(request.headers, userId.data, mutation.data.email);
    } else {
      await resetManagedUserPassword(request.headers, userId.data, mutation.data.password);
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const userId = idSchema.safeParse((await context.params).userId);
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = deleteSchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!userId.success || !body.success) {
    return NextResponse.json({ error: "Invalid account deletion." }, { status: 400 });
  }
  try {
    await deleteManagedUser(request.headers, userId.data, body.data.confirmationEmail);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
