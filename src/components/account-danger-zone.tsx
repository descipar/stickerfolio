"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

/**
 * Self-service account lifecycle controls.
 *
 * Deactivation is reversible (an administrator can reactivate); deletion is
 * permanent and therefore requires the caller to type the exact login email in
 * addition to the current password. Both are re-verified server-side, so the
 * confirmation is not merely a UI gate. Every action revokes the current
 * session, so on success the browser is sent to the login page.
 *
 * Data export first: users should export their collections before deleting.
 * The link points at the albums overview where the per-collection CSV export
 * (issue #68) lives; deletion itself never blocks on export.
 */
export function AccountDangerZone() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function deactivate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/account/deactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: String(form.get("currentPassword") ?? "") }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? "The account could not be deactivated.");
      setPending(false);
      return;
    }
    // Deactivation suspends the account and revokes every session.
    window.location.assign("/login");
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: String(form.get("currentPassword") ?? ""),
        confirmationEmail: String(form.get("confirmationEmail") ?? ""),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? "The account could not be deleted.");
      setPending(false);
      return;
    }
    window.location.assign("/login");
  }

  return (
    <div className="content-stack">
      <p className="muted">
        Before you leave, <Link href="/albums">export your collections</Link> so you keep a copy of
        your missing and duplicate lists. We cannot recover your data after deletion.
      </p>
      {error ? <p className="state-message error" role="alert">{error}</p> : null}

      <details className="password-reset">
        <summary>Deactivate account</summary>
        <p className="muted">
          Deactivation signs you out everywhere and blocks sign-in until an administrator reactivates
          your account. Your collections are kept.
        </p>
        <form className="form-stack" onSubmit={deactivate}>
          <label>
            Current password
            <input name="currentPassword" type="password" required autoComplete="current-password" />
          </label>
          <button className="secondary-button" type="submit" disabled={pending}>
            {pending ? "Working…" : "Deactivate account"}
          </button>
        </form>
      </details>

      <details className="password-reset">
        <summary>Delete account permanently</summary>
        <p className="muted">
          This permanently deletes your account, collector profile, collections, and holdings. This
          cannot be undone. Type your login email to confirm.
        </p>
        <form className="form-stack" onSubmit={remove}>
          <label>
            Confirm login email
            <input name="confirmationEmail" type="email" required maxLength={254} autoComplete="off" />
          </label>
          <label>
            Current password
            <input name="currentPassword" type="password" required autoComplete="current-password" />
          </label>
          <button className="primary-button danger" type="submit" disabled={pending}>
            {pending ? "Deleting…" : "Delete my account"}
          </button>
        </form>
      </details>
    </div>
  );
}
