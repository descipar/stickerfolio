import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminRegistration } from "@/components/admin-registration";
import { AppNavigation } from "@/components/app-navigation";
import { evaluateRegistration, resolveIdentity } from "@/modules/identity";

export default async function AdminRegistrationPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  if (identity.role !== "admin") redirect("/albums");
  const registration = evaluateRegistration();

  return (
    <main className="page-shell">
      <header className="app-header">
        <div><p className="eyebrow">Stickerfolio</p><h1 className="page-title">Registration</h1></div>
        <AppNavigation isAdmin />
      </header>
      <AdminRegistration mode={registration.mode} invitationsEnabled={registration.invitations} />
    </main>
  );
}
