"use client";

import { useState, type FormEvent } from "react";

export function PasswordChangeForm() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmation") ?? "")) {
      setMessage("The new passwords do not match.");
      setPending(false);
      return;
    }
    const response = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: String(form.get("currentPassword") ?? ""),
        newPassword,
      }),
    });
    if (!response.ok) {
      setMessage("The password could not be changed. Check the current password and requirements.");
      setPending(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        Current password
        <input name="currentPassword" type="password" autoComplete="current-password" required />
      </label>
      <label>
        New password
        <input name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
      </label>
      <label>
        Confirm new password
        <input name="confirmation" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
      </label>
      {message ? <p className="form-error" role="alert">{message}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
