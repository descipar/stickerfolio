import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AlbumsOverview } from "@/components/albums-overview";
import { AppNavigation } from "@/components/app-navigation";
import { resolveIdentity } from "@/modules/identity";

export default async function AlbumsPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");

  return (
    <main className="page-shell">
      <header className="app-header">
        <Link className="brand-link" href="/albums"><span aria-hidden="true">S</span><strong>Stickerfolio</strong></Link>
        <AppNavigation isAdmin={identity.role === "admin"} displayName={identity.collector?.displayName} />
      </header>
      {identity.collector
        ? <AlbumsOverview displayName={identity.collector.displayName} />
        : identity.role === "admin"
          ? (
              <section className="card empty-state">
                <h2>Album management is not available yet</h2>
                <p className="muted">
                  This administrator account has no personal collection. Creating album templates will be added with the catalog administration feature.
                </p>
              </section>
            )
          : <section className="card empty-state"><h2>Collector profile required</h2><p className="muted">Ask an administrator to add a collector profile to this account.</p></section>}
    </main>
  );
}
