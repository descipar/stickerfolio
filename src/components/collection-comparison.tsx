"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import type { ComparisonGrantSummary } from "@/modules/trading";

interface CreatedComparison {
  grant: ComparisonGrantSummary;
  code: string;
  url: string;
  qrDataUrl: string;
}

export function CollectionComparison({ collectionId }: { collectionId: string }) {
  const [grants, setGrants] = useState<ComparisonGrantSummary[] | null>(null);
  const [created, setCreated] = useState<CreatedComparison | null>(null);
  const [pending, setPending] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const capabilityCheck = window.setTimeout(() => {
      setCanNativeShare(typeof navigator.share === "function");
    }, 0);
    void fetch(`/api/collections/${collectionId}/comparison-grants`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { grants: ComparisonGrantSummary[] };
        setGrants(data.grants);
      })
      .catch(() => setError("Comparison codes could not be loaded."));
    return () => window.clearTimeout(capabilityCheck);
  }, [collectionId]);

  async function createGrant() {
    setPending(true);
    setMessage("");
    setError("");
    const response = await fetch(`/api/collections/${collectionId}/comparison-grants`, {
      method: "POST",
    });
    if (!response.ok) {
      setError("The comparison code could not be created.");
      setPending(false);
      return;
    }
    const data = await response.json() as CreatedComparison;
    setCreated(data);
    setGrants((current) => [data.grant, ...(current ?? [])]);
    setMessage("Comparison code created. It is valid for 15 minutes.");
    setPending(false);
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
      setError("");
    } catch {
      setError(`Copying is unavailable. Select and copy the ${label.toLowerCase()} manually.`);
    }
  }

  async function shareComparison() {
    if (!created) return;
    try {
      await navigator.share({
        title: "Compare sticker albums",
        text: `Open this Stickerfolio comparison or enter code ${created.code}.`,
        url: created.url,
      });
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError("The comparison could not be shared.");
    }
  }

  async function revokeGrant(grantId: string) {
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/collections/${collectionId}/comparison-grants/${grantId}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      setError("The comparison code could not be revoked.");
      setPending(false);
      return;
    }
    setGrants((current) => current?.map((grant) => (
      grant.id === grantId ? { ...grant, status: "revoked" } : grant
    )) ?? []);
    if (created?.grant.id === grantId) setCreated(null);
    setMessage("Comparison code revoked.");
    setPending(false);
  }

  return (
    <section className="card comparison-panel" aria-labelledby="comparison-sharing-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Meet and compare</p>
          <h2 id="comparison-sharing-title">Direct comparison</h2>
        </div>
      </div>
      <p className="muted">
        Create a private 15-minute code for another signed-in collector. It reveals
        only the stickers relevant to your direct comparison and does not enable public trading.
      </p>
      <button
        className="primary-button inline-action"
        type="button"
        disabled={pending}
        onClick={() => void createGrant()}
      >
        Create comparison code
      </button>

      {created ? (
        <div className="comparison-created" role="status">
          <Image
            className="comparison-qr"
            src={created.qrDataUrl}
            width={240}
            height={240}
            unoptimized
            alt="QR code that opens this direct Stickerfolio comparison"
          />
          <div className="comparison-created-copy">
            <p className="eyebrow">Manual code</p>
            <strong className="comparison-code">{created.code}</strong>
            <small>
              Expires {new Date(created.grant.expiresAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
            <small>Copy or share it now; Stickerfolio stores neither the link nor the manual code.</small>
            <div className="share-actions">
              <button className="secondary-button" type="button" onClick={() => void copy(created.code, "Code")}>Copy code</button>
              <button className="secondary-button" type="button" onClick={() => void copy(created.url, "Link")}>Copy link</button>
              {canNativeShare ? (
                <button className="secondary-button" type="button" onClick={() => void shareComparison()}>Share…</button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {message ? <p className="state-message success" role="status">{message}</p> : null}
      {error ? <p className="state-message error" role="alert">{error}</p> : null}

      <div className="share-list">
        <h3>Recent comparison codes</h3>
        {grants === null ? (
          <p className="muted">Loading comparison codes…</p>
        ) : grants.length === 0 ? (
          <p className="muted">No comparison codes have been created for this album.</p>
        ) : grants.map((grant) => (
          <article className="share-row" key={grant.id}>
            <div>
              <strong>Direct comparison</strong>
              <span>
                Created {new Date(grant.createdAt).toLocaleString()} · expires {new Date(grant.expiresAt).toLocaleString()}
              </span>
              <small className={`status-badge ${grant.status}`}>{grant.status}</small>
            </div>
            {grant.status === "active" ? (
              <button
                className="text-button danger"
                type="button"
                disabled={pending}
                onClick={() => void revokeGrant(grant.id)}
              >
                Revoke
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
