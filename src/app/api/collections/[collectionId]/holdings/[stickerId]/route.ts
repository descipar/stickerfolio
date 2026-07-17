import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveCollector } from "@/lib/active-collector";
import { updateHolding } from "@/lib/db";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({ quantity: z.number().int().min(0).max(99) });

export async function PATCH(request: Request, context: { params: Promise<{ collectionId: string; stickerId: string }> }) {
  try {
    const { collectionId, stickerId } = await context.params;
    const collector = await getActiveCollector();
    if (!collector) return NextResponse.json({ error: "Bitte zuerst einen Sammler auswählen." }, { status: 400 });
    const payload = payloadSchema.parse(await request.json());
    const quantity = updateHolding(collector.id, Number(collectionId), Number(stickerId), payload.quantity);
    return NextResponse.json({ quantity });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Der Bestand konnte nicht gespeichert werden.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
