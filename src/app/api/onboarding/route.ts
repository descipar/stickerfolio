import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import { completeOnboarding } from "@/modules/collections";

import { apiError, requestBodyTooLarge } from "../http";

const schema = z.object({
  displayName: z.string().trim().min(1).max(100),
  albumIds: z.array(z.uuid()).max(50),
});

export async function POST(request: Request): Promise<NextResponse> {
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = schema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) return NextResponse.json({ error: "Invalid onboarding selection." }, { status: 400 });
  try {
    return NextResponse.json(await completeOnboarding(request.headers, body.data), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
