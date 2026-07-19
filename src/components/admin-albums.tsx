"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";

interface ManagedRevision {
  id: string;
  number: number;
  label: string;
  status: "draft" | "published" | "archived";
  sectionCount: number;
  stickerCount: number;
}

interface ManagedAlbum {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  revisions: ManagedRevision[];
}

function starterTemplate(): string {
  const albumId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();
  return JSON.stringify({
    formatVersion: 1,
    album: { id: albumId, slug: "new-album", title: "New album", description: "" },
    revision: { id: revisionId, number: 1, label: "First edition", status: "draft" },
    sections: [{ id: sectionId, code: "A", name: "Section A", sortOrder: 0 }],
    stickers: [{
      stableId: crypto.randomUUID(),
      stableKey: "A1",
      sectionId,
      code: "A1",
      label: "A1",
      sortOrder: 0,
    }],
  }, null, 2);
}

export function AdminAlbums() {
  const [albums, setAlbums] = useState<ManagedAlbum[] | null>(null);
  const [template, setTemplate] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/albums", { cache: "no-store" });
    if (!response.ok) {
      setError("Album templates could not be loaded.");
      return;
    }
    setAlbums((await response.json() as { albums: ManagedAlbum[] }).albums);
  }, []);

  useEffect(() => {
    void fetch("/api/admin/albums", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) {
        setError("Album templates could not be loaded.");
        return;
      }
      setAlbums((await response.json() as { albums: ManagedAlbum[] }).albums);
    });
  }, []);

  const preview = useMemo(() => {
    if (!template.trim()) return null;
    try {
      const value = JSON.parse(template) as {
        album?: { title?: unknown };
        revision?: { label?: unknown };
        sections?: unknown[];
        stickers?: unknown[];
      };
      return {
        validJson: true,
        title: typeof value.album?.title === "string" ? value.album.title : "Untitled album",
        revision: typeof value.revision?.label === "string" ? value.revision.label : "Unlabelled revision",
        sections: Array.isArray(value.sections) ? value.sections.length : 0,
        stickers: Array.isArray(value.stickers) ? value.stickers.length : 0,
      };
    } catch {
      return { validJson: false, title: "", revision: "", sections: 0, stickers: 0 };
    }
  }, [template]);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("The album template is larger than 2 MB.");
      return;
    }
    setError("");
    setTemplate(await file.text());
  }

  async function importTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/admin/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: template,
    });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "The album template could not be imported.");
    } else {
      setTemplate("");
      setMessage("Album template imported as a draft revision.");
      await load();
    }
    setPending(false);
  }

  async function updateRevision(albumId: string, revisionId: string, action: "publish" | "archive") {
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/admin/albums/${albumId}/revisions/${revisionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "The album revision could not be updated.");
    } else {
      setMessage(action === "publish"
        ? "Revision published. The previous published revision was archived."
        : "Revision archived. Existing collections remain unchanged.");
      await load();
    }
    setPending(false);
  }

  async function updateMetadata(event: FormEvent<HTMLFormElement>, album: ManagedAlbum) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const revisionId = String(data.get("revisionId") ?? "");
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/admin/albums/${album.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revisionId,
        title: String(data.get("title") ?? ""),
        description: String(data.get("description") ?? "").trim() || null,
      }),
    });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "Album metadata could not be updated.");
    } else {
      setMessage("Album metadata updated and recorded as a correction.");
      await load();
    }
    setPending(false);
  }

  return (
    <div className="content-stack admin-albums">
      {message ? <p className="state-message success" role="status">{message}</p> : null}
      {error ? <p className="state-message error" role="alert">{error}</p> : null}

      <section className="card" aria-labelledby="import-album-title">
        <p className="eyebrow">Portable catalog</p>
        <h2 id="import-album-title">Import album template</h2>
        <p className="muted">Upload or paste a portable JSON template. Imports are always created as drafts and never add personal collections or holdings.</p>
        <form className="form-stack" onSubmit={importTemplate}>
          <label>
            JSON file (maximum 2 MB)
            <input type="file" accept="application/json,.json" onChange={(event) => void selectFile(event)} />
          </label>
          <label>
            Template JSON
            <textarea
              className="template-editor"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              rows={14}
              spellCheck={false}
              required
            />
          </label>
          <div className="template-actions">
            <button className="secondary-button" type="button" onClick={() => setTemplate(starterTemplate())}>Create starter template</button>
            <button className="primary-button" type="submit" disabled={pending || !preview?.validJson}>{pending ? "Validating…" : "Validate and import draft"}</button>
          </div>
          {preview ? (
            <p className={`template-preview ${preview.validJson ? "success" : "error"}`} role="status">
              {preview.validJson
                ? `${preview.title} · ${preview.revision} · ${preview.sections} sections · ${preview.stickers} stickers`
                : "The pasted content is not valid JSON."}
            </p>
          ) : null}
        </form>
      </section>

      <section aria-labelledby="managed-albums-title">
        <div className="section-heading">
          <div><p className="eyebrow">Shared catalog</p><h2 id="managed-albums-title">Album templates</h2></div>
          <span className="count-badge">{albums?.length ?? 0}</span>
        </div>
        {!albums && !error ? <p className="state-message" role="status">Loading album templates…</p> : null}
        {albums?.length === 0 ? <div className="card empty-state"><p>No album templates have been imported yet.</p></div> : null}
        <div className="managed-album-list">
          {albums?.map((album) => (
            <article className="card managed-album-card" key={album.id}>
              <div>
                <h3>{album.title}</h3>
                <p className="muted">{album.slug}{album.description ? ` · ${album.description}` : ""}</p>
              </div>
              <div className="revision-list">
                {album.revisions.map((revision) => (
                  <div className="revision-row" key={revision.id}>
                    <div>
                      <strong>Revision {revision.number}: {revision.label}</strong>
                      <span>{revision.sectionCount} sections · {revision.stickerCount} stickers</span>
                    </div>
                    <span className={`status-badge ${revision.status}`}>{revision.status}</span>
                    {revision.status === "draft" ? (
                      <button className="primary-button" disabled={pending} onClick={() => void updateRevision(album.id, revision.id, "publish")}>Publish</button>
                    ) : null}
                    {revision.status === "published" ? (
                      <button className="secondary-button" disabled={pending} onClick={() => void updateRevision(album.id, revision.id, "archive")}>Archive</button>
                    ) : null}
                  </div>
                ))}
              </div>
              <details className="metadata-editor">
                <summary>Edit album metadata</summary>
                <form className="form-stack" onSubmit={(event) => void updateMetadata(event, album)}>
                  <input type="hidden" name="revisionId" value={album.revisions[0]?.id} />
                  <label>Title<input name="title" defaultValue={album.title} required maxLength={200} /></label>
                  <label>Description<input name="description" defaultValue={album.description ?? ""} maxLength={1000} /></label>
                  <button className="primary-button" disabled={pending} type="submit">Save metadata</button>
                </form>
              </details>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
