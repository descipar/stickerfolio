import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminAlbums } from "@/components/admin-albums";
import { AppNavigation } from "@/components/app-navigation";
import { resolveIdentity } from "@/modules/identity";

export default async function AdminAlbumsPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  if (identity.role !== "admin") redirect("/albums");

  return (
    <main className="page-shell wide-shell">
      <header className="app-header">
        <div><p className="eyebrow">Stickerfolio</p><h1 className="page-title">Album management</h1></div>
        <AppNavigation isAdmin />
      </header>
      <AdminAlbums />
    </main>
  );
}
