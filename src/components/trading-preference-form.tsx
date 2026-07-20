"use client";

import { useState } from "react";

export function TradingPreferenceForm({ initialVisible }: { initialVisible: boolean }) {
  const [visible, setVisible] = useState(initialVisible);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function update(nextVisible: boolean) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/trading", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible: nextVisible }),
      });
      if (!response.ok) throw new Error("Preference update failed");
      setVisible(nextVisible);
      setMessage(nextVisible ? "You now appear in trade matches." : "You are hidden from all trade matches.");
    } catch {
      setMessage("The trading preference could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="preference-control">
      <label className="preference-toggle">
        <input
          type="checkbox"
          checked={visible}
          disabled={pending}
          onChange={(event) => void update(event.target.checked)}
        />
        <span>
          <strong>Appear in trade matching</strong>
          <small>Other opted-in collectors can see your display name and only the stickers relevant to a possible trade.</small>
        </span>
      </label>
      {message ? <p className={`state-message ${message.includes("could not") ? "error" : "success"}`} role="status">{message}</p> : null}
    </div>
  );
}
