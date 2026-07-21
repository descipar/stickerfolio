import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/register-form";
import { evaluateRegistration, resolveIdentity } from "@/modules/identity";

export default async function RegisterPage() {
  const identity = await resolveIdentity(await headers());
  if (identity) redirect(identity.mustChangePassword ? "/password/change" : "/albums");
  const registration = evaluateRegistration();

  return (
    <main className="page-shell auth-page">
      <section className="card" aria-labelledby="register-title">
        <p className="eyebrow">Stickerfolio</p>
        <h1 id="register-title" className="page-title">Create your account</h1>
        {registration.openRegistration ? (
          <>
            <p className="muted">Register to start tracking your sticker albums.</p>
            <RegisterForm />
          </>
        ) : (
          <>
            <p className="muted">
              {registration.mode === "invitation"
                ? "Registration is currently by invitation only. Ask an administrator for an invitation link."
                : "Self-registration is currently closed. Ask an administrator to create an account for you."}
            </p>
            <Link className="primary-button inline-action" href="/login">Back to sign in</Link>
          </>
        )}
      </section>
    </main>
  );
}
