import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppNavigation } from "@/components/app-navigation";
import { CollectionView } from "@/components/collection-view";
import { resolveIdentity } from "@/modules/identity";

export default async function CollectionPage({ params }: { params: Promise<{ collectionId: string }> }) {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  if (!identity.collector) redirect(identity.role === "admin" ? "/admin/users" : "/");
  const { collectionId } = await params;

  return (
    <main className="page-shell wide-shell">
      <header className="app-header">
        <div>
          <Link className="back-link" href="/albums">← Albums</Link>
          <h1 className="page-title">Stickers</h1>
        </div>
        <AppNavigation isAdmin={identity.role === "admin"} />
      </header>
      <CollectionView collectionId={collectionId} />
    </main>
  );
}
