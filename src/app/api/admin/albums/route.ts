import { NextResponse } from "next/server";

import { readLimitedText } from "@/infrastructure/http";
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
  const requestBody = await readLimitedText(request, maximumTemplateBytes);
  if (requestBody.status === "too-large") {
    return NextResponse.json({ error: "The album template is larger than 2 MB." }, { status: 413 });
  }
  if (requestBody.status === "invalid") {
    return NextResponse.json({ error: "The album template is not valid JSON." }, { status: 400 });
  }
  let template: unknown;
  try {
    template = JSON.parse(requestBody.value);
  } catch {
    return NextResponse.json({ error: "The album template is not valid JSON." }, { status: 400 });
  }
  try {
    return NextResponse.json(await importAdminAlbumTemplate(request.headers, template), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
