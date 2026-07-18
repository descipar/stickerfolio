import { NextResponse } from "next/server";

import { getVersionInformation, writeLog } from "@/infrastructure/observability";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getVersionInformation(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    writeLog("warn", "version.schema_unavailable", { error });
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
