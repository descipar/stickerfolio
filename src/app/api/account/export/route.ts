import { NextResponse } from "next/server";

import { accountExportFileName, exportOwnAccountData } from "@/modules/identity";

import { apiError } from "../../http";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const exportedAt = new Date();
    const data = await exportOwnAccountData(request.headers, undefined, undefined, exportedAt);
    return new NextResponse(`${JSON.stringify(data, null, 2)}\n`, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${accountExportFileName(exportedAt)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
