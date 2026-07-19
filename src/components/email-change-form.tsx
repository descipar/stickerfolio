"use client";

import { useState, type FormEvent } from "react";

export function EmailChangeForm() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/account/email", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(form.get("email") ?? ""),
        currentPassword: String(form.get("currentPassword") ?? ""),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setMessage(body?.error ?? "The email address could not be changed.");
      setPending(false);
      return;
    }
    // The change revokes every session, including this one, so the browser must
    // re-authenticate with the new address.
    window.location.assign("/login");
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        New login email
        <input name="email" type="email" maxLength={254} autoComplete="email" required />
      </label>
      <label>
        Current password
        <input name="currentPassword" type="password" autoComplete="current-password" required />
      </label>
      {message ? <p className="form-error" role="alert">{message}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change email"}
      </button>
    </form>
  );
}
