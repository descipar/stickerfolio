import { NextResponse } from "next/server";
import { z } from "zod";

import { readLimitedJson } from "@/infrastructure/http";
import { getOwnTradingVisibility, setOwnTradingVisibility } from "@/modules/trading";

import { apiError, requestBodyTooLarge } from "../../http";

const bodySchema = z.object({ visible: z.boolean() });

export async function GET(request: Request): Promise<NextResponse> {
  try {
    return NextResponse.json({ visible: await getOwnTradingVisibility(request.headers) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  const requestBody = await readLimitedJson(request);
  if (requestBody.status === "too-large") return requestBodyTooLarge();
  const body = bodySchema.safeParse(requestBody.status === "ok" ? requestBody.value : null);
  if (!body.success) return NextResponse.json({ error: "Invalid trading preference." }, { status: 400 });
  try {
    await setOwnTradingVisibility(request.headers, body.data.visible);
    return NextResponse.json({ visible: body.data.visible });
  } catch (error) {
    return apiError(error);
  }
}
