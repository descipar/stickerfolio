import { NextResponse } from "next/server";
import { escapeCsv } from "@/lib/csv";
import { getActiveCollector } from "@/lib/active-collector";
import { getAlbum } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ albumId: string }> }) {
  const { albumId } = await context.params;
  const collector = await getActiveCollector();
  if (!collector) return NextResponse.json({ error: "Bitte zuerst einen Sammler auswählen." }, { status: 400 });
  const album = getAlbum(collector.id, Number(albumId));
  if (!album) return NextResponse.json({ error: "Album nicht gefunden." }, { status: 404 });
  const format = new URL(request.url).searchParams.get("format") ?? "csv";

  if (format === "json") {
    const body = JSON.stringify({
      exportedAt: new Date().toISOString(),
      collector: collector.name,
      album: { name: album.name, description: album.description },
      stickers: album.stickers.map(({ code, label, sectionCode, sectionName, quantity }) => ({ code, label, sectionCode, sectionName, quantity })),
    }, null, 2);
    return new NextResponse(body, {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${album.slug}-${collector.slug}.json"` },
    });
  }

  const header = "section_code,section_name,sticker_code,label,quantity,status";
  const rows = album.stickers.map((sticker) => [
    sticker.sectionCode,
    sticker.sectionName,
    sticker.code,
    sticker.label,
    sticker.quantity,
    sticker.quantity === 0 ? "fehlt" : sticker.quantity === 1 ? "vorhanden" : "doppelt",
  ].map(escapeCsv).join(","));
  return new NextResponse([header, ...rows].join("\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${album.slug}-${collector.slug}.csv"` },
  });
}
