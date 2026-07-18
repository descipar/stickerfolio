import { NextResponse } from "next/server";

import { getLivenessStatus } from "@/infrastructure/observability";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json(getLivenessStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
