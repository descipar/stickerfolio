"use client";

import { useEffect, useState } from "react";

type ShareScope = "missing" | "duplicates" | "both";
type ShareStatus = "active" | "expired" | "revoked";

interface ShareSummary {
  id: string;
  scope: ShareScope;
  status: ShareStatus;
  expiresAt: string | null;
  createdAt: string;
}

const scopeLabels: Record<ShareScope, string> = {
  missing: "Missing stickers",
  duplicates: "Duplicates",
  both: "Missing stickers and duplicates",
};

export function CollectionSharing({ collectionId }: { collectionId: string }) {
  const [shares, setShares] = useState<ShareSummary[] | null>(null);
  const [sharingEnabled, setSharingEnabled] = useState<boolean | null>(null);
  const [scope, setScope] = useState<ShareScope>("both");
  const [expirationDate, setExpirationDate] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    const capabilityCheck = window.setTimeout(() => {
      setCanNativeShare(typeof navigator.share === "function");
    }, 0);
    void fetch(`/api/collections/${collectionId}/shares`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as {
          shares: ShareSummary[];
          sharingEnabled: boolean;
        };
        setShares(data.shares);
        setSharingEnabled(data.sharingEnabled);
      })
      .catch(() => setError("Share links could not be loaded."));
    return () => window.clearTimeout(capabilityCheck);
  }, [collectionId]);

  async function createShare() {
    setPending(true);
    setError("");
    setMessage("");
    setCreatedUrl("");
    const expiresAt = expirationDate
      ? new Date(`${expirationDate}T23:59:59.999Z`).toISOString()
      : null;
    const response = await fetch(`/api/collections/${collectionId}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, expiresAt }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string } | null;
      setError(data?.error ?? "The share link could not be created.");
      setPending(false);
      return;
    }
    const data = await response.json() as { share: ShareSummary; url: string };
    setShares((current) => [data.share, ...(current ?? [])]);
    setCreatedUrl(data.url);
    setExpirationDate("");
    setMessage("Share link created. Copy it now; the full link is not stored.");
    setPending(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(createdUrl);
      setMessage("Link copied.");
    } catch {
      setError("Copying is unavailable. Select and copy the link manually.");
    }
  }

  async function shareLink() {
    try {
      await navigator.share({
        title: "Stickerfolio shared list",
        text: "My current Stickerfolio missing and duplicate list",
        url: createdUrl,
      });
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError("The link could not be shared.");
    }
  }

  async function updateShare(
    shareId: string,
    input: { scope?: ShareScope; expiresAt?: string | null },
  ) {
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/collections/${collectionId}/shares/${shareId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) {
      setError("The share link could not be updated.");
      setPending(false);
      return;
    }
    const data = await response.json() as { share: ShareSummary };
    setShares((current) => current?.map((share) => (
      share.id === shareId ? data.share : share
    )) ?? []);
    setMessage("Share settings updated.");
    setPending(false);
  }

  async function revokeShare(shareId: string) {
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/collections/${collectionId}/shares/${shareId}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      setError("The share link could not be revoked.");
      setPending(false);
      return;
    }
    setShares((current) => current?.map((share) => (
      share.id === shareId ? { ...share, status: "revoked" } : share
    )) ?? []);
    setMessage("Share link revoked.");
    setPending(false);
  }

  return (
    <section className="card sharing-panel" aria-labelledby="sharing-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Read-only sharing</p>
          <h2 id="sharing-title">Share your lists</h2>
        </div>
      </div>
      <p className="muted">
        Anyone with a link can view the selected live list without an account.
        Links never allow quantity changes.
      </p>

      {sharingEnabled === false ? (
        <p className="state-message" role="status">
          Sharing is unavailable on this installation. The administrator must
          configure an externally reachable <code>PUBLIC_SHARE_BASE_URL</code>.
        </p>
      ) : (
        <div className="share-create-grid">
          <label>
            Visible list
            <select value={scope} onChange={(event) => setScope(event.target.value as ShareScope)}>
              <option value="both">Missing stickers and duplicates</option>
              <option value="missing">Missing stickers only</option>
              <option value="duplicates">Duplicates only</option>
            </select>
          </label>
          <label>
            Expiration date <span className="field-hint">(optional, UTC)</span>
            <input
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={expirationDate}
              onChange={(event) => setExpirationDate(event.target.value)}
            />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={pending || sharingEnabled !== true}
            onClick={() => void createShare()}
          >
            Create share link
          </button>
        </div>
      )}

      {createdUrl ? (
        <div className="created-share" role="status">
          <label>
            New share link
            <input readOnly value={createdUrl} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <div className="share-actions">
            <button className="secondary-button" type="button" onClick={() => void copyLink()}>
              Copy link
            </button>
            {canNativeShare ? (
              <button className="secondary-button" type="button" onClick={() => void shareLink()}>
                Share…
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {message ? <p className="state-message success" role="status">{message}</p> : null}
      {error ? <p className="state-message error" role="alert">{error}</p> : null}

      <div className="share-list">
        <h3>Created links</h3>
        {shares === null ? (
          <p className="muted">Loading share links…</p>
        ) : shares.length === 0 ? (
          <p className="muted">No share links have been created for this album.</p>
        ) : shares.map((share) => (
          <article className="share-row" key={share.id}>
            <div>
              <strong>{scopeLabels[share.scope]}</strong>
              <span>
                Created {new Date(share.createdAt).toLocaleDateString()}
                {share.expiresAt
                  ? ` · expires ${new Date(share.expiresAt).toLocaleDateString()}`
                  : " · no expiration"}
              </span>
              <small className={`status-badge ${share.status}`}>{share.status}</small>
            </div>
            {share.status === "active" ? (
              <div className="share-actions">
                <select
                  aria-label="Visible list"
                  value={share.scope}
                  disabled={pending}
                  onChange={(event) => void updateShare(
                    share.id,
                    { scope: event.target.value as ShareScope },
                  )}
                >
                  <option value="both">Both lists</option>
                  <option value="missing">Missing only</option>
                  <option value="duplicates">Duplicates only</option>
                </select>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={pending}
                  onClick={() => void updateShare(share.id, { expiresAt: new Date().toISOString() })}
                >
                  Expire now
                </button>
                <button
                  className="text-button danger"
                  type="button"
                  disabled={pending}
                  onClick={() => void revokeShare(share.id)}
                >
                  Revoke
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
