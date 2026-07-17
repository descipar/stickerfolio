"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewAlbumForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    const response = await fetch("/api/albums/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description, csv }),
    });
    const body = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(body.error ?? "Das Album konnte nicht importiert werden.");
      return;
    }
    router.push(`/albums/${body.albumId}`);
    router.refresh();
  }

  return (
    <div className="narrow-page stack page-enter">
      <Link href="/" className="back-link">‹ Zurück</Link>
      <section className="hero"><p className="eyebrow">Neues Album</p><h1>Album importieren</h1><p className="muted">Ein CSV-Katalog legt ein beliebiges neues Album für Sarah an. Alle Sticker starten als fehlend.</p></section>
      <form className="form-card" onSubmit={submit}>
        <label><span>Albumname</span><input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Bundesliga 2027" /></label>
        <label><span>Beschreibung <small>optional</small></span><input maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ausgabe oder Besonderheiten" /></label>
        <label className="file-field">
          <span>Stickerkatalog als CSV</span>
          <input required type="file" accept=".csv,text/csv" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setFileName(file.name);
            setCsv(await file.text());
          }} />
          <div><strong>{fileName || "CSV auswählen"}</strong><span>{fileName ? "Datei geladen" : "Tippen, um eine Datei zu wählen"}</span></div>
        </label>
        <a className="template-link" href="/album-vorlage.csv" download>CSV-Vorlage herunterladen</a>
        {error && <p className="form-error">{error}</p>}
        <button className="button button-primary button-large" disabled={pending || !csv}>{pending ? "Wird importiert …" : "Album anlegen"}</button>
      </form>
      <section className="hint-card"><strong>Benötigte Spalten</strong><code>section_code, section_name, sticker_code, sticker_number, label</code><p>Ein Bereich kann ein Team, eine Seite oder eine beliebige Kategorie sein.</p></section>
    </div>
  );
}
