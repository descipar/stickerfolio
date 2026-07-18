import { NextResponse } from "next/server";
import { z } from "zod";

import { AuthenticationError, changeOwnPassword } from "@/modules/identity";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128),
});

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid password input." }, { status: 400 });

  try {
    await changeOwnPassword(
      request.headers,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    return NextResponse.json({ changed: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Authentication required." }, { status: error.status });
    }
    return NextResponse.json({ error: "The password could not be changed." }, { status: 400 });
  }
}
