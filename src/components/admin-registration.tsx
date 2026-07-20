"use client";

import { useEffect, useState, type FormEvent } from "react";

type RegistrationMode = "closed" | "invitation" | "open";

interface Invitation {
  id: string;
  email: string;
  displayName: string | null;
  status: "pending" | "accepted" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
}

const modeCopy: Record<RegistrationMode, string> = {
  closed: "Registration is closed. Only administrators can create accounts.",
  invitation: "Registration is by invitation only. Share single-use invitation links with new collectors.",
  open: "Open self-registration is enabled. Anyone who can reach the app can create an account.",
};

/**
 * A fetch aborted by our AbortController (on unmount/effect re-run) rejects with an
 * AbortError. That is expected teardown and must be ignored; any other rejection is a
 * genuine failure that should surface to the user.
 */
export function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}

export function AdminRegistration({
  mode,
  invitationsEnabled,
}: {
  mode: RegistrationMode;
  invitationsEnabled: boolean;
}) {
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/invitations", { cache: "no-store" });
    if (!response.ok) {
      setError("Invitations could not be loaded.");
      return;
    }
    setInvitations((await response.json() as { invitations: Invitation[] }).invitations);
  }

  useEffect(() => {
    if (!invitationsEnabled) return;
    const controller = new AbortController();
    void fetch("/api/admin/invitations", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          setError("Invitations could not be loaded.");
          return;
        }
        const data = (await response.json()) as { invitations: Invitation[] };
        setInvitations(data.invitations);
      })
      .catch((cause: unknown) => {
        // Ignore the abort from unmount/effect re-run; surface any genuine failure
        // so the user sees an error instead of an endless loading state.
        if (isAbortError(cause)) return;
        setError("Invitations could not be loaded.");
      });
    return () => controller.abort();
  }, [invitationsEnabled]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    setLink("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(data.get("email") ?? ""),
        displayName: String(data.get("displayName") ?? "").trim() || undefined,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "The invitation could not be created.");
      setPending(false);
      return;
    }
    const invitation = (await response.json()) as { token: string };
    setLink(`${window.location.origin}/register/invitation?token=${encodeURIComponent(invitation.token)}`);
    setMessage("Invitation created. Copy the single-use link below; it is shown only once.");
    form.reset();
    await load();
    setPending(false);
  }

  async function revoke(id: string) {
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/admin/invitations/${id}`, { method: "DELETE" });
    if (!response.ok) setError("The invitation could not be revoked.");
    else {
      setMessage("Invitation revoked.");
      await load();
    }
    setPending(false);
  }

  return (
    <div className="content-stack">
      <section className="card" aria-labelledby="registration-mode-title">
        <p className="eyebrow">Configuration</p>
        <h2 id="registration-mode-title">Active registration mode</h2>
        <p><span className={`status-badge ${mode}`}>{mode}</span></p>
        <p className="muted">{modeCopy[mode]}</p>
        <p className="muted">
          The mode is set with the REGISTRATION_MODE environment variable. Email verification is
          disabled in the MVP, so open registration should be enabled only in trusted deployments.
        </p>
      </section>

      {invitationsEnabled ? (
        <>
          {message ? <p className="state-message success" role="status">{message}</p> : null}
          {error ? <p className="state-message error" role="alert">{error}</p> : null}
          {link ? (
            <section className="card" aria-label="Invitation link">
              <p className="eyebrow">Single-use link</p>
              <p className="break-word">{link}</p>
            </section>
          ) : null}

          <section className="card" aria-labelledby="create-invitation-title">
            <p className="eyebrow">New invitation</p>
            <h2 id="create-invitation-title">Invite a collector</h2>
            <form className="form-stack" onSubmit={create}>
              <label>Email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
              <label>Display name (optional)<input name="displayName" maxLength={100} autoComplete="off" /></label>
              <button className="primary-button" type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create invitation"}
              </button>
            </form>
          </section>

          <section aria-labelledby="invitations-title">
            <div className="section-heading">
              <div><p className="eyebrow">Administration</p><h2 id="invitations-title">Invitations</h2></div>
              <span className="count-badge">{invitations?.length ?? 0}</span>
            </div>
            {!invitations && !error ? <p className="state-message" role="status">Loading invitations…</p> : null}
            <div className="user-list">
              {invitations?.map((invitation) => (
                <article className="card user-card" key={invitation.id}>
                  <div>
                    <h3 className="break-word">{invitation.email}</h3>
                    {invitation.displayName ? <p className="muted">{invitation.displayName}</p> : null}
                    <div className="badge-row">
                      <span className={`status-badge ${invitation.status}`}>{invitation.status}</span>
                      <span className="muted">expires {new Date(invitation.expiresAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="user-actions">
                    <button
                      className="secondary-button"
                      disabled={pending || invitation.status !== "pending"}
                      onClick={() => void revoke(invitation.id)}
                    >
                      Revoke
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="card">
          <p className="muted">Invitation links are available only when the registration mode is set to invitation.</p>
        </section>
      )}
    </div>
  );
}
