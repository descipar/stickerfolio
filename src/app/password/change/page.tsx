import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { PasswordChangeForm } from "@/components/password-change-form";
import { resolveIdentity } from "@/modules/identity";

export default async function ChangePasswordPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) redirect("/login");
  if (!identity.mustChangePassword) redirect("/albums");

  return (
    <main className="page-shell auth-page">
      <section className="card" aria-labelledby="password-title">
        <p className="eyebrow">Required step</p>
        <h1 id="password-title" className="page-title">Choose a new password</h1>
        <p className="muted">Change the temporary password before using any other feature.</p>
        <PasswordChangeForm />
        <LogoutButton />
      </section>
    </main>
  );
}
