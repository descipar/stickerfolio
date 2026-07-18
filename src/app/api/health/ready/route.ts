import { NextResponse } from "next/server";

import { getReadinessStatus, writeLog } from "@/infrastructure/observability";

export const dynamic = "force-dynamic";

export async function createReadinessResponse(
  checkReadiness: typeof getReadinessStatus = getReadinessStatus,
): Promise<NextResponse> {
  try {
    return NextResponse.json(await checkReadiness(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    writeLog("warn", "health.readiness_failed", { error });
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return createReadinessResponse();
}
