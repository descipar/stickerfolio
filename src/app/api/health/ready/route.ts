import { NextResponse } from "next/server";

import { getReadinessStatus, writeLog } from "@/infrastructure/observability";

export const dynamic = "force-dynamic";

export async function createReadinessResponse(
  checkReadiness: typeof getReadinessStatus = getReadinessStatus,
): Promise<NextResponse> {
  try {
    const readiness = await checkReadiness();
    if (readiness.status !== "ready") {
      writeLog("warn", "health.schema_behind", {
        schema: readiness.schema,
        expectedSchema: readiness.expectedSchema,
      });
    } else if (readiness.schemaState === "ahead") {
      writeLog("info", "health.schema_ahead", {
        schema: readiness.schema,
        expectedSchema: readiness.expectedSchema,
      });
    }
    return NextResponse.json(readiness, {
      status: readiness.status === "ready" ? 200 : 503,
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
