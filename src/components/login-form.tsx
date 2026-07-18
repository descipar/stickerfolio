"use client";

import { useState, type FormEvent } from "react";

import { authClient } from "./auth-client";

export function LoginForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (result.error) {
      setError("Email or password is incorrect.");
      setPending(false);
      return;
    }
    window.location.assign("/");
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required inputMode="email" />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
