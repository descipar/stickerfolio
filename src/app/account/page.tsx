import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AccountDangerZone } from "@/components/account-danger-zone";
import { AppNavigation } from "@/components/app-navigation";
import { EmailChangeForm } from "@/components/email-change-form";
import { TradingPreferenceForm } from "@/components/trading-preference-form";
import { resolveIdentity } from "@/modules/identity";
import { getTradingVisibility } from "@/modules/trading";

export default async function AccountPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (identity.mustChangePassword) redirect("/password/change");
  const tradingVisible = identity.collector
    ? await getTradingVisibility(identity.collector.id)
    : false;

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
      {identity.collector ? (
        <section className="card account-section" aria-labelledby="trading-visibility-title">
          <p className="eyebrow">Trading</p>
          <h2 id="trading-visibility-title">Trade matching visibility</h2>
          <p className="muted">Trading is private by default. Opt in only when you want to appear in automatic matches.</p>
          <TradingPreferenceForm initialVisible={tradingVisible} />
        </section>
      ) : null}
      <section className="card account-section" aria-labelledby="account-danger-title">
        <p className="eyebrow">Danger zone</p>
        <h2 id="account-danger-title">Deactivate or delete account</h2>
        <p className="muted">
          Deactivation is reversible by an administrator. Deletion is permanent and removes your
          collections and holdings.
        </p>
        <AccountDangerZone />
      </section>
    </main>
  );
}
