import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { resolveIdentity } from "@/modules/identity";

export default async function LoginPage() {
  const identity = await resolveIdentity(await headers());
  if (identity) redirect(identity.mustChangePassword ? "/password/change" : "/albums");

  return (
    <main className="page-shell auth-page">
      <section className="card" aria-labelledby="login-title">
        <p className="eyebrow">Stickerfolio</p>
        <h1 id="login-title" className="page-title">Welcome to Stickerfolio</h1>
        <p className="muted">Sign in to manage your sticker albums.</p>
        <LoginForm />
      </section>
    </main>
  );
}
