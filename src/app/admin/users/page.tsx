import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminUsers } from "@/components/admin-users";
import { AppNavigation } from "@/components/app-navigation";
import { resolveIdentity } from "@/modules/identity";

export default async function AdminUsersPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  if (identity.role !== "admin") redirect("/albums");

  return (
    <main className="page-shell">
      <header className="app-header">
        <div><p className="eyebrow">Stickerfolio</p><h1 className="page-title">User management</h1></div>
        <AppNavigation isAdmin />
      </header>
      <AdminUsers currentUserId={identity.userId} />
    </main>
  );
}
