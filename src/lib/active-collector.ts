import "server-only";

import { cookies } from "next/headers";
import { getCollector, getCollectors } from "@/lib/db";
import type { Collector } from "@/lib/types";

export const ACTIVE_COLLECTOR_COOKIE = "stickerfolio_collector";

export async function getActiveCollector(): Promise<Collector | null> {
  const cookieStore = await cookies();
  const requestedId = Number(cookieStore.get(ACTIVE_COLLECTOR_COOKIE)?.value);
  if (Number.isSafeInteger(requestedId) && requestedId > 0) {
    const requested = getCollector(requestedId);
    if (requested) return requested;
  }
  return getCollectors()[0] ?? null;
}
