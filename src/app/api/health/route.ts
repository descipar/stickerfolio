import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  getDb().prepare("SELECT 1").get();
  return NextResponse.json({ status: "ok" });
}
