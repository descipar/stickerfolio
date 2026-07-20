"use client";

import { useState, type FormEvent } from "react";

import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

import { authClient } from "./auth-client";

export function InvitationAcceptForm({
  token,
  email,
  displayName,
}: {
  token: string;
  email: string;
  displayName: string;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const response = await fetch("/api/register/invitation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password, displayName: String(form.get("displayName") ?? "") }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "The invitation could not be accepted.");
      setPending(false);
      return;
    }
    const signIn = await authClient.signIn.email({ email, password });
    window.location.assign(signIn.error ? "/login" : "/onboarding");
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        Email
        <input value={email} readOnly disabled autoComplete="email" />
      </label>
      <label>
        Display name
        <input name="displayName" required maxLength={100} defaultValue={displayName} autoComplete="nickname" />
      </label>
      <label>
        Password
        <span className="field-hint" id="invite-password-hint">At least {minimumPasswordLength} characters</span>
        <input
          name="password"
          type="password"
          required
          minLength={minimumPasswordLength}
          maxLength={maximumPasswordLength}
          autoComplete="new-password"
          aria-describedby="invite-password-hint"
        />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Accept invitation"}
      </button>
    </form>
  );
}
