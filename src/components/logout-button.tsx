"use client";

import { useState } from "react";

import { authClient } from "./auth-client";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  return (
    <button
      className="secondary-button"
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        window.location.assign("/login");
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
