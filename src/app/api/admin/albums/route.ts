import { NextResponse } from "next/server";

import { importAdminAlbumTemplate, listAdminAlbums } from "@/modules/admin";

import { apiError } from "../../http";

const maximumTemplateBytes = 2 * 1024 * 1024;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    return NextResponse.json({ albums: await listAdminAlbums(request.headers) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumTemplateBytes) {
    return NextResponse.json({ error: "The album template is larger than 2 MB." }, { status: 413 });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumTemplateBytes) {
    return NextResponse.json({ error: "The album template is larger than 2 MB." }, { status: 413 });
  }
  let template: unknown;
  try {
    template = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "The album template is not valid JSON." }, { status: 400 });
  }
  try {
    return NextResponse.json(await importAdminAlbumTemplate(request.headers, template), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
