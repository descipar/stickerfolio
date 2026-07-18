import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AlbumsOverview } from "@/components/albums-overview";
import { AppNavigation } from "@/components/app-navigation";
import { resolveIdentity } from "@/modules/identity";

export default async function AlbumsPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  if (!identity.collector && identity.role === "admin") redirect("/admin/users");

  return (
    <main className="page-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Stickerfolio</p>
          <h1 className="page-title">Albums</h1>
        </div>
        <AppNavigation isAdmin={identity.role === "admin"} />
      </header>
      {identity.collector ? <AlbumsOverview /> : (
        <section className="card empty-state"><h2>Collector profile required</h2><p className="muted">Ask an administrator to add a collector profile to this account.</p></section>
      )}
    </main>
  );
}
