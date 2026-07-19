import { NextResponse } from "next/server";
import { z } from "zod";

import { exportOwnCollection } from "@/modules/collections";

import { apiError } from "../../../http";

const idSchema = z.uuid();
const typeSchema = z.enum(["missing", "duplicates"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ collectionId: string }> },
): Promise<NextResponse> {
  const parsed = idSchema.safeParse((await context.params).collectionId);
  const type = typeSchema.safeParse(new URL(request.url).searchParams.get("type"));
  if (!parsed.success || !type.success) {
    return NextResponse.json({ error: "Invalid export request." }, { status: 400 });
  }
  try {
    const { filename, content } = await exportOwnCollection(request.headers, parsed.data, type.data);
    // UTF-8 CSV download; the filename documents the album and list type.
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
