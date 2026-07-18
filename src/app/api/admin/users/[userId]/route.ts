import { NextResponse } from "next/server";
import { z } from "zod";

import {
  resetManagedUserPassword,
  setManagedUserRole,
  setManagedUserStatus,
} from "@/modules/admin";

import { apiError } from "../../../http";

const idSchema = z.uuid();
const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), status: z.enum(["active", "suspended"]) }),
  z.object({ action: z.literal("role"), role: z.enum(["user", "admin"]) }),
  z.object({ action: z.literal("reset-password"), password: z.string().min(10).max(128) }),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse> {
  const userId = idSchema.safeParse((await context.params).userId);
  const mutation = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!userId.success || !mutation.success) {
    return NextResponse.json({ error: "Invalid user update." }, { status: 400 });
  }
  try {
    if (mutation.data.action === "status") {
      await setManagedUserStatus(request.headers, userId.data, mutation.data.status);
    } else if (mutation.data.action === "role") {
      await setManagedUserRole(request.headers, userId.data, mutation.data.role);
    } else {
      await resetManagedUserPassword(request.headers, userId.data, mutation.data.password);
    }
    return NextResponse.json({ updated: true });
  } catch (error) {
    return apiError(error);
  }
}
