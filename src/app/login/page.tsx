import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { evaluateRegistration, resolveIdentity } from "@/modules/identity";

export default async function LoginPage() {
  const identity = await resolveIdentity(await headers());
  if (identity) redirect(identity.mustChangePassword ? "/password/change" : "/albums");
  const registration = evaluateRegistration();

  return (
    <main className="page-shell auth-page">
      <section className="card" aria-labelledby="login-title">
        <p className="eyebrow">Stickerfolio</p>
        <h1 id="login-title" className="page-title">Welcome to Stickerfolio</h1>
        <p className="muted">Sign in to manage your sticker albums.</p>
        <LoginForm />
        {registration.openRegistration ? (
          <p className="muted">New here? <Link href="/register">Create an account</Link></p>
        ) : null}
      </section>
    </main>
  );
}
