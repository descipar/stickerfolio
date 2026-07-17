import type { Metadata } from "next";
import { CollectorManager } from "@/components/collector-manager";
import { getActiveCollector } from "@/lib/active-collector";
import { getCollectors } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sammler" };

export default async function CollectorsPage() {
  const [collectors, active] = await Promise.all([Promise.resolve(getCollectors()), getActiveCollector()]);
  return <CollectorManager collectors={collectors} activeId={active?.id ?? null} />;
}
