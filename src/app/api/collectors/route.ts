import { NextResponse } from "next/server";
import { z } from "zod";
import { ACTIVE_COLLECTOR_COOKIE } from "@/lib/active-collector";
import { createCollector } from "@/lib/db";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({ name: z.string().trim().min(2).max(60) });

export async function POST(request: Request) {
  try {
    const payload = payloadSchema.parse(await request.json());
    const collector = createCollector(payload.name);
    const response = NextResponse.json({ collector }, { status: 201 });
    response.cookies.set(ACTIVE_COLLECTOR_COOKIE, String(collector.id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Der Sammler konnte nicht angelegt werden.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
