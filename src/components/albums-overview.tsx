"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Collection {
  id: string;
  albumId: string;
  albumTitle: string;
  revisionNumber: number;
  owned: number;
  duplicates: number;
  total: number;
}

interface Album {
  id: string;
  title: string;
  description: string | null;
  stickerCount: number;
}

interface Overview {
  collections: Collection[];
  availableAlbums: Album[];
}

export function AlbumsOverview({ displayName }: { displayName: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/collections", { cache: "no-store" });
    if (!response.ok) {
      setMessage("Albums could not be loaded.");
      return;
    }
    setOverview(await response.json() as Overview);
  }, []);

  useEffect(() => {
    void fetch("/api/collections", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) {
        setMessage("Albums could not be loaded.");
        return;
      }
      setOverview(await response.json() as Overview);
    });
  }, []);

  const totals = useMemo(() => {
    const collections = overview?.collections ?? [];
    return collections.reduce(
      (result, collection) => ({
        owned: result.owned + collection.owned,
        missing: result.missing + collection.total - collection.owned,
        duplicates: result.duplicates + collection.duplicates,
        total: result.total + collection.total,
      }),
      { owned: 0, missing: 0, duplicates: 0, total: 0 },
    );
  }, [overview]);

  async function addAlbum(albumId: string) {
    setPending(true);
    setMessage("");
    const response = await fetch("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumId }),
    });
    if (!response.ok) setMessage("The album could not be added.");
    else await load();
    setPending(false);
  }

  async function removeAlbum(collectionId: string) {
    if (!window.confirm("Remove this album and all of its quantities?")) return;
    setPending(true);
    setMessage("");
    const response = await fetch(`/api/collections/${collectionId}`, { method: "DELETE" });
    if (!response.ok) setMessage("The album could not be removed.");
    else await load();
    setPending(false);
  }

  if (!overview && !message) return <p className="state-message" role="status">Loading albums…</p>;
  if (!overview) return <p className="state-message error" role="alert">{message}</p>;

  return (
    <div className="album-overview content-stack">
      <section className="overview-intro" aria-labelledby="album-overview-title">
        <p className="eyebrow">Hello {displayName}</p>
        <h1 id="album-overview-title" className="overview-title">Your sticker albums</h1>
        <p className="overview-subtitle">Check off stickers, count duplicates, and keep your progress in view.</p>
        <Link className="secondary-button inline-action overview-compare-action" href="/compare">
          Enter a comparison code
        </Link>
      </section>

      {overview.collections.length > 0 ? (
        <section className="overview-stats" aria-label="Collection totals">
          <article className="overview-stat overview-stat-primary">
            <span>Collected</span><strong>{totals.owned}</strong><small>of {totals.total}</small>
          </article>
          <article className="overview-stat">
            <span>Missing</span><strong>{totals.missing}</strong><small>stickers</small>
          </article>
          <article className="overview-stat">
            <span>Duplicates</span><strong>{totals.duplicates}</strong><small>extra copies</small>
          </article>
        </section>
      ) : null}

      {message ? <p className="state-message error" role="alert">{message}</p> : null}

      <section aria-labelledby="your-albums-title">
        <div className="section-heading">
          <div><p className="eyebrow">Collection</p><h2 id="your-albums-title">Albums</h2></div>
          <span className="count-badge">{overview.collections.length}</span>
        </div>
        {overview.collections.length === 0 ? (
          <div className="card empty-state">
            <h3>No albums yet</h3>
            <p className="muted">Add a published album below to start tracking stickers.</p>
          </div>
        ) : (
          <div className="collection-card-list">
            {overview.collections.map((collection) => {
              const percent = collection.total ? Math.round(collection.owned / collection.total * 100) : 0;
              return (
                <article className="collection-card" key={collection.id}>
                  <Link className="collection-card-main" href={`/albums/${collection.id}`}>
                    <span className="album-cover" aria-hidden="true"><b>★</b><small>Album</small></span>
                    <span className="collection-card-copy">
                      <strong>{collection.albumTitle}</strong>
                      <small>{collection.total} stickers · revision {collection.revisionNumber}</small>
                      <span className="collection-progress-copy"><span>{collection.owned} / {collection.total}</span><b>{percent}%</b></span>
                      <span className="progress-track"><span style={{ width: `${percent}%` }} /></span>
                      <span className="collection-breakdown">{collection.total - collection.owned} missing · {collection.duplicates} duplicates</span>
                    </span>
                    <span className="collection-chevron" aria-hidden="true">›</span>
                  </Link>
                  <button className="collection-remove" disabled={pending} onClick={() => void removeAlbum(collection.id)}>Remove</button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="available-albums-title">
        <div className="section-heading"><div><p className="eyebrow">Catalog</p><h2 id="available-albums-title">Available albums</h2></div></div>
        {overview.availableAlbums.length === 0 ? (
          <p className="muted">No additional published albums are available.</p>
        ) : (
          <div className="album-grid">
            {overview.availableAlbums.map((album) => (
              <article className="card album-card" key={album.id}>
                <h3>{album.title}</h3>
                <p className="muted">{album.description ?? `${album.stickerCount} stickers`}</p>
                <button className="primary-button" disabled={pending} onClick={() => void addAlbum(album.id)}>Add album</button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
