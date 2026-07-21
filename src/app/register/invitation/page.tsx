import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InvitationAcceptForm } from "@/components/invitation-accept-form";
import { evaluateRegistration, findValidInvitationByToken, resolveIdentity } from "@/modules/identity";

export default async function InvitationRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const identity = await resolveIdentity(await headers());
  if (identity) redirect(identity.mustChangePassword ? "/password/change" : "/albums");
  const registration = evaluateRegistration();
  const { token } = await searchParams;
  const invitation = registration.invitations && token ? await findValidInvitationByToken(token) : null;

  return (
    <main className="page-shell auth-page">
      <section className="card" aria-labelledby="invite-title">
        <p className="eyebrow">Stickerfolio</p>
        <h1 id="invite-title" className="page-title">Accept your invitation</h1>
        {!registration.invitations ? (
          <>
            <p className="muted">Invitations are not being accepted right now.</p>
            <Link className="primary-button inline-action" href="/login">Back to sign in</Link>
          </>
        ) : !invitation ? (
          <>
            <p className="muted">
              This invitation link is invalid, has expired, or has already been used. Ask an
              administrator for a new invitation.
            </p>
            <Link className="primary-button inline-action" href="/login">Back to sign in</Link>
          </>
        ) : (
          <>
            <p className="muted">Set a password to finish creating your account.</p>
            <InvitationAcceptForm token={token!} email={invitation.email} displayName={invitation.displayName ?? ""} />
          </>
        )}
      </section>
    </main>
  );
}
