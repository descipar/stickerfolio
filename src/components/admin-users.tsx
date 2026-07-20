"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

interface ManagedUser {
  id: string;
  email: string;
  accountName: string;
  displayName: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  mustChangePassword: boolean;
  createdAt: string;
}

export function AdminUsers({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    if (!response.ok) {
      setError("User accounts could not be loaded.");
      return;
    }
    setUsers((await response.json() as { users: ManagedUser[] }).users);
  }, []);

  useEffect(() => {
    void fetch("/api/admin/users", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) {
        setError("User accounts could not be loaded.");
        return;
      }
      setUsers((await response.json() as { users: ManagedUser[] }).users);
    });
  }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(data.get("email") ?? ""),
        displayName: String(data.get("displayName") ?? ""),
        initialPassword: String(data.get("initialPassword") ?? ""),
        role: String(data.get("role") ?? "user"),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? "The user could not be created.");
    } else {
      form.reset();
      setMessage("User created. They must change the initial password at first sign-in.");
      await load();
    }
    setPending(false);
  }

  async function mutate(userId: string, body: object, success: string) {
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      setError(data?.error ?? "The account could not be updated.");
    } else {
      setMessage(success);
      await load();
    }
    setPending(false);
  }

  async function removeUser(userId: string, confirmationEmail: string) {
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmationEmail }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      setError(data?.error ?? "The account could not be deleted.");
    } else {
      setMessage("Account permanently deleted.");
      await load();
    }
    setPending(false);
  }

  async function changeOwnEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/account/email", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(data.get("email") ?? ""),
        currentPassword: String(data.get("currentPassword") ?? ""),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? "The email address could not be changed.");
      setPending(false);
      return;
    }
    // Changing your own email revokes every session, including this one, so
    // re-authenticate with the new address.
    window.location.assign("/login");
  }

  return (
    <div className="content-stack">
      {message ? <p className="state-message success" role="status">{message}</p> : null}
      {error ? <p className="state-message error" role="alert">{error}</p> : null}

      <section className="card" aria-labelledby="create-user-title">
        <p className="eyebrow">New account</p>
        <h2 id="create-user-title">Create user</h2>
        <form className="form-stack" onSubmit={createUser}>
          <label>Display name<input name="displayName" required maxLength={100} autoComplete="off" /></label>
          <label>Email<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
          <label>
            Initial password
            <span className="field-hint" id="initial-password-hint">At least {minimumPasswordLength} characters</span>
            <input
              name="initialPassword"
              type="password"
              required
              minLength={minimumPasswordLength}
              maxLength={maximumPasswordLength}
              aria-describedby="initial-password-hint"
              autoComplete="new-password"
            />
          </label>
          <label>Role<select name="role" defaultValue="user"><option value="user">User</option><option value="admin">Administrator</option></select></label>
          <button className="primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Create user"}</button>
        </form>
      </section>

      <section aria-labelledby="users-title">
        <div className="section-heading"><div><p className="eyebrow">Administration</p><h2 id="users-title">Users</h2></div><span className="count-badge">{users?.length ?? 0}</span></div>
        {!users && !error ? <p className="state-message" role="status">Loading users…</p> : null}
        <div className="user-list">
          {users?.map((user) => {
            const self = user.id === currentUserId;
            return (
              <article className="card user-card" key={user.id}>
                <div>
                  <h3>{user.displayName ?? user.accountName}</h3>
                  <p className="muted break-word">{user.email}</p>
                  <div className="badge-row">
                    <span className="status-badge">{user.role}</span>
                    <span className={`status-badge ${user.status}`}>{user.status}</span>
                    {user.mustChangePassword ? <span className="status-badge warning">password change required</span> : null}
                    {self ? <span className="status-badge">you</span> : null}
                  </div>
                </div>
                <div className="user-actions">
                  <button className="secondary-button" disabled={pending || self} onClick={() => void mutate(user.id, { action: "role", role: user.role === "admin" ? "user" : "admin" }, "Role updated.")}>{user.role === "admin" ? "Make user" : "Make admin"}</button>
                  <button className="secondary-button" disabled={pending || self} onClick={() => void mutate(user.id, { action: "status", status: user.status === "active" ? "suspended" : "active" }, user.status === "active" ? "User suspended and sessions revoked." : "User activated.")}>{user.status === "active" ? "Suspend" : "Activate"}</button>
                  {!self ? (
                    <>
                      <details className="password-reset">
                        <summary>Reset password</summary>
                        <form onSubmit={(event) => {
                          event.preventDefault();
                          const form = event.currentTarget;
                          const password = String(new FormData(form).get("password") ?? "");
                          void mutate(user.id, { action: "reset-password", password }, "Password reset and active sessions revoked.").then(() => form.reset());
                        }}>
                          <label>
                            <span className="visually-hidden">New temporary password for {user.email}</span>
                            <span className="field-hint" id={`reset-password-hint-${user.id}`}>
                              At least {minimumPasswordLength} characters
                            </span>
                            <input
                              name="password"
                              type="password"
                              minLength={minimumPasswordLength}
                              maxLength={maximumPasswordLength}
                              aria-describedby={`reset-password-hint-${user.id}`}
                              required
                              autoComplete="new-password"
                              placeholder="Temporary password"
                            />
                          </label>
                          <button className="primary-button" type="submit" disabled={pending}>Set password</button>
                        </form>
                      </details>
                      <details className="password-reset">
                        <summary>Change login email</summary>
                        <form key={user.email} onSubmit={(event) => {
                          event.preventDefault();
                          const form = event.currentTarget;
                          const email = String(new FormData(form).get("email") ?? "");
                          void mutate(user.id, { action: "email", email }, "Login email updated and the user's sessions were revoked.").then(() => form.reset());
                        }}>
                          <label>
                            <span className="visually-hidden">New login email for {user.email}</span>
                            <input
                              name="email"
                              type="email"
                              defaultValue={user.email}
                              maxLength={254}
                              required
                              autoComplete="off"
                              placeholder="New login email"
                            />
                          </label>
                          <button className="primary-button" type="submit" disabled={pending}>Set email</button>
                        </form>
                      </details>
                      <details className="password-reset">
                        <summary>Delete account</summary>
                        <p className="muted">
                          Permanently deletes this account and its collections and holdings. This
                          cannot be undone. Ask the user to export their data first; administrators
                          cannot access another user's holdings. Type the account email to confirm.
                        </p>
                        <form key={`delete-${user.email}`} onSubmit={(event) => {
                          event.preventDefault();
                          const form = event.currentTarget;
                          const confirmationEmail = String(new FormData(form).get("confirmationEmail") ?? "");
                          void removeUser(user.id, confirmationEmail).then(() => form.reset());
                        }}>
                          <label>
                            <span className="visually-hidden">Confirm the login email of {user.email}</span>
                            <input
                              name="confirmationEmail"
                              type="email"
                              maxLength={254}
                              required
                              autoComplete="off"
                              placeholder="Confirm account email"
                            />
                          </label>
                          <button className="primary-button danger" type="submit" disabled={pending}>Delete account</button>
                        </form>
                      </details>
                    </>
                  ) : (
                    <details className="password-reset">
                      <summary>Change login email</summary>
                      <form className="account-email-form" key={user.email} onSubmit={changeOwnEmail}>
                        <label>
                          <span>Email</span>
                          <input name="email" type="email" defaultValue={user.email} maxLength={254} required autoComplete="email" />
                        </label>
                        <label>
                          <span>Current password</span>
                          <input name="currentPassword" type="password" required autoComplete="current-password" />
                        </label>
                        <button className="primary-button" type="submit" disabled={pending}>Change email</button>
                      </form>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
