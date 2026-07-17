"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { AlbumDetail, StickerView } from "@/lib/types";

type Filter = "all" | "missing" | "owned" | "duplicates";

function statusOf(quantity: number) {
  if (quantity === 0) return { label: "Fehlt", className: "is-missing" };
  if (quantity === 1) return { label: "Vorhanden", className: "is-owned" };
  return { label: `${quantity - 1}× doppelt`, className: "is-duplicate" };
}

export function AlbumTracker({ initialAlbum }: { initialAlbum: AlbumDetail }) {
  const [stickers, setStickers] = useState(initialAlbum.stickers);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [section, setSection] = useState<number | "all">("all");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const stats = useMemo(() => ({
    total: stickers.length,
    owned: stickers.filter((sticker) => sticker.quantity > 0).length,
    missing: stickers.filter((sticker) => sticker.quantity === 0).length,
    duplicates: stickers.reduce((sum, sticker) => sum + Math.max(0, sticker.quantity - 1), 0),
  }), [stickers]);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("de");
    return stickers.filter((sticker) => {
      const sectionMatches = section === "all" || sticker.sectionId === section;
      const searchMatches = !needle || `${sticker.code} ${sticker.label} ${sticker.sectionName}`.toLocaleLowerCase("de").includes(needle);
      const filterMatches = filter === "all" || (filter === "missing" && sticker.quantity === 0) || (filter === "owned" && sticker.quantity > 0) || (filter === "duplicates" && sticker.quantity > 1);
      return sectionMatches && searchMatches && filterMatches;
    });
  }, [filter, search, section, stickers]);

  function changeQuantity(sticker: StickerView, quantity: number) {
    const nextQuantity = Math.max(0, Math.min(99, quantity));
    if (nextQuantity === sticker.quantity) return;
    const previous = sticker.quantity;
    setStickers((current) => current.map((item) => item.id === sticker.id ? { ...item, quantity: nextQuantity } : item));
    setMessage("");
    startTransition(async () => {
      const response = await fetch(`/api/collections/${initialAlbum.collectionId}/holdings/${sticker.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantity: nextQuantity }),
      });
      if (!response.ok) {
        setStickers((current) => current.map((item) => item.id === sticker.id ? { ...item, quantity: previous } : item));
        const body = await response.json().catch(() => ({}));
        setMessage(body.error ?? "Änderung konnte nicht gespeichert werden.");
      } else {
        setMessage(`${sticker.code} gespeichert`);
        window.setTimeout(() => setMessage(""), 1600);
      }
    });
  }

  return (
    <div className="stack album-page page-enter">
      <Link href="/" className="back-link">‹ Alle Alben</Link>
      <section className="album-hero">
        <div><p className="eyebrow">Sarahs Sammlung</p><h1>{initialAlbum.name}</h1><p className="muted">{initialAlbum.description}</p></div>
        <div className="completion-ring" style={{ "--progress": `${Math.round((stats.owned / stats.total) * 100)}%` } as React.CSSProperties}>
          <strong>{Math.round((stats.owned / stats.total) * 100)}%</strong><span>fertig</span>
        </div>
      </section>

      <section className="stat-grid album-stats">
        <button className={`stat-card ${filter === "missing" ? "is-active" : ""}`} onClick={() => setFilter(filter === "missing" ? "all" : "missing")}><span>Fehlen</span><strong>{stats.missing}</strong></button>
        <button className={`stat-card ${filter === "owned" ? "is-active" : ""}`} onClick={() => setFilter(filter === "owned" ? "all" : "owned")}><span>Vorhanden</span><strong>{stats.owned}</strong></button>
        <button className={`stat-card ${filter === "duplicates" ? "is-active" : ""}`} onClick={() => setFilter(filter === "duplicates" ? "all" : "duplicates")}><span>Doubletten</span><strong>{stats.duplicates}</strong></button>
      </section>

      <div className="tracker-tools">
        <label className="search-box"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code oder Team suchen" autoCapitalize="characters" /></label>
        <div className="export-menu"><a href={`/api/albums/${initialAlbum.id}/export?format=csv`} download>CSV</a><a href={`/api/albums/${initialAlbum.id}/export?format=json`} download>JSON</a></div>
      </div>

      <div className="section-scroller" aria-label="Bereiche">
        <button className={section === "all" ? "active" : ""} onClick={() => setSection("all")}>Alle</button>
        {initialAlbum.sections.map((item) => {
          const currentOwned = stickers.filter((sticker) => sticker.sectionId === item.id && sticker.quantity > 0).length;
          return <button className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)} key={item.id}><b>{item.code}</b><span>{currentOwned}/{item.total}</span></button>;
        })}
      </div>

      <div className="result-heading"><h2>{section === "all" ? "Alle Sticker" : initialAlbum.sections.find((item) => item.id === section)?.name}</h2><span>{visible.length} Treffer</span></div>
      <div className="sticker-list" aria-live="polite">
        {visible.map((sticker) => {
          const status = statusOf(sticker.quantity);
          return (
            <article className={`sticker-row ${status.className}`} key={sticker.id}>
              <button className="check-button" onClick={() => changeQuantity(sticker, sticker.quantity === 0 ? 1 : sticker.quantity === 1 ? 0 : sticker.quantity)} aria-label={sticker.quantity === 0 ? `${sticker.code} als vorhanden markieren` : `${sticker.code} ist vorhanden`} aria-pressed={sticker.quantity > 0}>
                {sticker.quantity > 0 ? "✓" : ""}
              </button>
              <div className="sticker-identity"><strong>{sticker.code}</strong><span>{sticker.sectionName}</span></div>
              <span className="status-label">{status.label}</span>
              <div className="quantity-control">
                <button onClick={() => changeQuantity(sticker, sticker.quantity - 1)} disabled={sticker.quantity === 0} aria-label={`${sticker.code} Anzahl reduzieren`}>−</button>
                <output aria-label={`${sticker.quantity} Exemplare`}>{sticker.quantity}</output>
                <button onClick={() => changeQuantity(sticker, sticker.quantity + 1)} aria-label={`${sticker.code} Anzahl erhöhen`}>+</button>
              </div>
            </article>
          );
        })}
        {visible.length === 0 && <div className="empty-state"><span>✓</span><h3>Keine Sticker gefunden</h3><p>Ändere den Filter oder den Suchbegriff.</p></div>}
      </div>
      {message && <div className={`toast ${message.includes("nicht") ? "toast-error" : ""}`}>{message}</div>}
    </div>
  );
}
