"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Collector } from "@/lib/types";

export function CollectorManager({ collectors, activeId }: { collectors: Collector[]; activeId: number | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/collectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(body.error ?? "Der Sammler konnte nicht angelegt werden.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function select(collectorId: number) {
    setPending(true);
    setError("");
    const response = await fetch("/api/collectors/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collectorId }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(body.error ?? "Der Sammler konnte nicht ausgewählt werden.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="narrow-page stack page-enter">
      {collectors.length > 0 && <Link href="/" className="back-link">‹ Zurück</Link>}
      <section className="hero">
        <p className="eyebrow">Sammler</p>
        <h1>{collectors.length === 0 ? "Wer sammelt?" : "Sammler verwalten"}</h1>
        <p className="muted">Jeder Sammler erhält eigene Alben, Bestände und Doubletten.</p>
      </section>

      {collectors.length > 0 && (
        <section className="collector-list" aria-label="Vorhandene Sammler">
          {collectors.map((collector) => (
            <button type="button" className={`collector-card ${collector.id === activeId ? "is-active" : ""}`} onClick={() => select(collector.id)} disabled={pending} key={collector.id}>
              <span className="collector-avatar">{collector.name.slice(0, 1).toLocaleUpperCase("de")}</span>
              <span><strong>{collector.name}</strong><small>{collector.id === activeId ? "Aktiv" : "Auswählen"} · Kennung: {collector.slug}</small></span>
              <b aria-hidden="true">{collector.id === activeId ? "✓" : "›"}</b>
            </button>
          ))}
        </section>
      )}

      <form className="form-card" onSubmit={create}>
        <div><p className="eyebrow">Neu</p><h2>Sammler anlegen</h2></div>
        <label><span>Name</span><input required minLength={2} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Sammler 1" autoComplete="name" /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="button button-primary button-large" disabled={pending || name.trim().length < 2}>{pending ? "Wird gespeichert …" : "Sammler anlegen"}</button>
      </form>
    </div>
  );
}
