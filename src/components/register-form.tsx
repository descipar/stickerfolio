"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

import { authClient } from "./auth-client";

export function RegisterForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const response = await fetch("/api/register/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName: String(form.get("displayName") ?? "") }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "The account could not be created.");
      setPending(false);
      return;
    }
    // Establish a session with the just-created credentials, then continue to
    // onboarding. If sign-in fails for any reason, fall back to the login page.
    const signIn = await authClient.signIn.email({ email, password });
    window.location.assign(signIn.error ? "/login" : "/onboarding");
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        Display name
        <input name="displayName" required maxLength={100} autoComplete="nickname" />
      </label>
      <label>
        Email
        <input name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" />
      </label>
      <label>
        Password
        <span className="field-hint" id="register-password-hint">At least {minimumPasswordLength} characters</span>
        <input
          name="password"
          type="password"
          required
          minLength={minimumPasswordLength}
          maxLength={maximumPasswordLength}
          autoComplete="new-password"
          aria-describedby="register-password-hint"
        />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </button>
      <p className="muted">Already have an account? <Link href="/login">Sign in</Link></p>
    </form>
  );
}
