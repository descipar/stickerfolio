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
                <h2>Manage the shared album catalog</h2>
                <p className="muted">
                  This administrator account has no personal collection. Create, import, publish, and archive album templates in the administration area.
                </p>
                <Link className="primary-button inline-action" href="/admin/albums">Open album management</Link>
              </section>
            )
          : <section className="card empty-state"><h2>Collector profile required</h2><p className="muted">Ask an administrator to add a collector profile to this account.</p></section>}
    </main>
  );
}
