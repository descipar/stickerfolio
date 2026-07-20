"use client";

import { useEffect, useState, type FormEvent } from "react";

interface Album {
  id: string;
  title: string;
  description: string | null;
  stickerCount: number;
}

export function OnboardingFlow({ initialDisplayName }: { initialDisplayName: string }) {
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/collections", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) {
        setError("Albums could not be loaded.");
        return;
      }
      const data = (await response.json()) as { availableAlbums: Album[] };
      setAlbums(data.availableAlbums);
    });
  }, []);

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const displayName = String(new FormData(event.currentTarget).get("displayName") ?? "");
    const response = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, albumIds: [...selected] }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Onboarding could not be completed.");
      setPending(false);
      return;
    }
    const data = (await response.json()) as { collections: { id: string }[] };
    window.location.assign(data.collections[0] ? `/albums/${data.collections[0].id}` : "/albums");
  }

  return (
    <form className="content-stack" onSubmit={submit}>
      <section className="card">
        <p className="eyebrow">Step 1</p>
        <h2>Confirm your display name</h2>
        <p className="muted">This name is shown to other collectors. It is never used to sign in.</p>
        <label>
          Display name
          <input name="displayName" required maxLength={100} defaultValue={initialDisplayName} autoComplete="nickname" />
        </label>
      </section>

      <section className="card">
        <p className="eyebrow">Step 2</p>
        <h2>Choose your albums</h2>
        <p className="muted">Select one or more published albums to start collecting. You can add more later.</p>
        {!albums && !error ? <p className="state-message" role="status">Loading albums…</p> : null}
        {albums && albums.length === 0 ? <p className="muted">No published albums are available yet.</p> : null}
        <div className="album-grid">
          {albums?.map((album) => (
            <label className="card album-card" key={album.id}>
              <input
                type="checkbox"
                checked={selected.has(album.id)}
                onChange={() => toggle(album.id)}
              />
              <span>
                <strong>{album.title}</strong>
                <small className="muted">{album.description ?? `${album.stickerCount} stickers`}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending
          ? "Setting up…"
          : selected.size > 0
            ? `Start collecting (${selected.size})`
            : "Continue without albums"}
      </button>
    </form>
  );
}
