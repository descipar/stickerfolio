import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import { AuthenticationError, changeOwnPassword } from "@/modules/identity";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

import { requestBodyTooLarge } from "../../http";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(minimumPasswordLength).max(maximumPasswordLength),
});

export async function POST(request: Request): Promise<NextResponse> {
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const parsed = bodySchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
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
