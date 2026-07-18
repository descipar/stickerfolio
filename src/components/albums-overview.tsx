"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Collection {
  id: string;
  albumId: string;
  albumTitle: string;
  revisionNumber: number;
  owned: number;
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

export function AlbumsOverview() {
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
    <div className="content-stack">
      {message ? <p className="state-message error" role="alert">{message}</p> : null}
      <section aria-labelledby="your-albums-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Collection</p>
            <h2 id="your-albums-title">Your albums</h2>
          </div>
          <span className="count-badge">{overview.collections.length}</span>
        </div>
        {overview.collections.length === 0 ? (
          <div className="card empty-state">
            <h3>No albums yet</h3>
            <p className="muted">Add a published album below to start tracking stickers.</p>
          </div>
        ) : (
          <div className="album-grid">
            {overview.collections.map((collection) => {
              const percent = collection.total ? Math.round(collection.owned / collection.total * 100) : 0;
              return (
                <article className="card album-card" key={collection.id}>
                  <Link className="card-link" href={`/albums/${collection.id}`}>
                    <span className="eyebrow">Revision {collection.revisionNumber}</span>
                    <h3>{collection.albumTitle}</h3>
                    <div className="progress-track" aria-label={`${percent}% complete`}>
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <p className="progress-copy">{collection.owned} of {collection.total} · {percent}%</p>
                  </Link>
                  <button className="text-button danger" disabled={pending} onClick={() => void removeAlbum(collection.id)}>
                    Remove album
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="available-albums-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Catalog</p>
            <h2 id="available-albums-title">Available albums</h2>
          </div>
        </div>
        {overview.availableAlbums.length === 0 ? (
          <p className="muted">No additional published albums are available.</p>
        ) : (
          <div className="album-grid">
            {overview.availableAlbums.map((album) => (
              <article className="card album-card" key={album.id}>
                <h3>{album.title}</h3>
                <p className="muted">{album.description ?? `${album.stickerCount} stickers`}</p>
                <button className="primary-button" disabled={pending} onClick={() => void addAlbum(album.id)}>
                  Add album
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
