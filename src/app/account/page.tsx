import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppNavigation } from "@/components/app-navigation";
import { EmailChangeForm } from "@/components/email-change-form";
import { resolveIdentity } from "@/modules/identity";

export default async function AccountPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");

  return (
    <main className="page-shell">
      <header className="app-header">
        <div><p className="eyebrow">Stickerfolio</p><h1 className="page-title">Account</h1></div>
        <AppNavigation isAdmin={identity.role === "admin"} displayName={identity.collector?.displayName} />
      </header>
      <section className="card" aria-labelledby="account-email-title">
        <p className="eyebrow">Login</p>
        <h2 id="account-email-title">Change login email</h2>
        <p className="muted">
          Your login email changes immediately. For your security you will be signed out of every
          device and must sign in again with the new address.
        </p>
        <EmailChangeForm />
      </section>
    </main>
  );
}
