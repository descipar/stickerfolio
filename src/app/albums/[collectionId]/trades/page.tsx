import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppNavigation } from "@/components/app-navigation";
import { TradeMatches } from "@/components/trade-matches";
import { resolveIdentity } from "@/modules/identity";

export default async function TradeMatchesPage({ params }: { params: Promise<{ collectionId: string }> }) {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  if (!identity.collector) redirect(identity.role === "admin" ? "/admin/users" : "/");
  const { collectionId } = await params;

  return (
    <main className="page-shell wide-shell">
      <header className="app-header">
        <Link className="brand-link" href="/albums"><span aria-hidden="true">S</span><strong>Stickerfolio</strong></Link>
        <AppNavigation isAdmin={identity.role === "admin"} displayName={identity.collector.displayName} />
      </header>
      <Link className="back-link" href={`/albums/${collectionId}`}>← Back to album</Link>
      <TradeMatches collectionId={collectionId} />
    </main>
  );
}
