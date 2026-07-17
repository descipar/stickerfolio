import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveCollector } from "@/lib/active-collector";
import { createAlbumForCollector } from "@/lib/db";
import { parseAlbumCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(240).default(""),
  csv: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const payload = payloadSchema.parse(await request.json());
    const collector = await getActiveCollector();
    if (!collector) return NextResponse.json({ error: "Bitte zuerst einen Sammler anlegen." }, { status: 400 });
    const stickers = parseAlbumCsv(payload.csv);
    const albumId = createAlbumForCollector(collector.id, payload.name, payload.description, stickers);
    return NextResponse.json({ albumId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Das Album konnte nicht importiert werden.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
