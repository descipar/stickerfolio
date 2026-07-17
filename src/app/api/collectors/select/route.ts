import { NextResponse } from "next/server";
import { z } from "zod";
import { ACTIVE_COLLECTOR_COOKIE } from "@/lib/active-collector";
import { getCollector } from "@/lib/db";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({ collectorId: z.number().int().positive() });

export async function POST(request: Request) {
  try {
    const payload = payloadSchema.parse(await request.json());
    const collector = getCollector(payload.collectorId);
    if (!collector) return NextResponse.json({ error: "Sammler nicht gefunden." }, { status: 404 });
    const response = NextResponse.json({ collector });
    response.cookies.set(ACTIVE_COLLECTOR_COOKIE, String(collector.id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Der Sammler konnte nicht ausgewählt werden.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
