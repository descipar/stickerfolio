"use client";

import { useState } from "react";

import type {
  ComparisonCredential,
  ComparisonSetup,
  DirectComparisonResult,
} from "@/modules/trading";

import { TradeStickerGroup } from "./trade-matches";

export function DirectComparisonJoin({
  initialCredential,
  initialSetup,
}: {
  initialCredential?: ComparisonCredential;
  initialSetup?: ComparisonSetup;
}) {
  const [code, setCode] = useState("");
  const [credential, setCredential] = useState<ComparisonCredential | null>(initialCredential ?? null);
  const [setup, setSetup] = useState<ComparisonSetup | null>(initialSetup ?? null);
  const [collectionId, setCollectionId] = useState(initialSetup?.collections[0]?.id ?? "");
  const [result, setResult] = useState<DirectComparisonResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function prepareCode() {
    setPending(true);
    setError("");
    setResult(null);
    const nextCredential = { code };
    const response = await fetch("/api/comparisons/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextCredential),
    });
    if (!response.ok) {
      setError("Comparison unavailable. Check the code, its expiry, and that you own the same album.");
      setPending(false);
      return;
    }
    const data = await response.json() as { setup: ComparisonSetup };
    setCredential(nextCredential);
    setSetup(data.setup);
    setCollectionId(data.setup.collections[0]?.id ?? "");
    setPending(false);
  }

  async function compare() {
    if (!credential || !collectionId) return;
    setPending(true);
    setError("");
    const response = await fetch("/api/comparisons/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...credential, collectionId }),
    });
    if (!response.ok) {
      setError("Comparison unavailable. The code may have expired or been revoked.");
      setResult(null);
      setPending(false);
      return;
    }
    const data = await response.json() as { result: DirectComparisonResult };
    setResult(data.result);
    setPending(false);
  }

  return (
    <div className="direct-comparison-flow content-stack">
      {!setup ? (
        <section className="card comparison-code-entry" aria-labelledby="comparison-code-title">
          <h2 id="comparison-code-title">Enter a comparison code</h2>
          <p className="muted">
            Ask the other collector for their short-lived code. Codes are not case-sensitive.
          </p>
          <label>
            Comparison code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABCDE-23456"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={16}
              onKeyDown={(event) => {
                if (event.key === "Enter") void prepareCode();
              }}
            />
          </label>
          <button className="primary-button" type="button" disabled={pending || !code.trim()} onClick={() => void prepareCode()}>
            Continue
          </button>
        </section>
      ) : (
        <section className="card comparison-selection" aria-labelledby="comparison-album-title">
          <div>
            <p className="eyebrow">Your side</p>
            <h2 id="comparison-album-title">Choose your album</h2>
          </div>
          <label>
            Compatible collection
            <select
              value={collectionId}
              disabled={pending}
              onChange={(event) => {
                setCollectionId(event.target.value);
                setResult(null);
              }}
            >
              {setup.collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.albumTitle} · revision {collection.revisionNumber}
                </option>
              ))}
            </select>
          </label>
          <div className="comparison-selection-actions">
            {!initialSetup ? (
              <button
                className="secondary-button"
                type="button"
                disabled={pending}
                onClick={() => {
                  setSetup(null);
                  setCredential(null);
                  setResult(null);
                  setError("");
                }}
              >
                Use another code
              </button>
            ) : null}
            <button className="primary-button" type="button" disabled={pending || !collectionId} onClick={() => void compare()}>
              Compare now
            </button>
          </div>
        </section>
      )}

      {error ? <p className="state-message error" role="alert">{error}</p> : null}

      {result ? (
        <section className="direct-comparison-result" aria-labelledby="direct-comparison-result-title">
          <div className="results-heading">
            <div>
              <p className="eyebrow">Direct comparison</p>
              <h2 id="direct-comparison-result-title">You and {result.partnerDisplayName}</h2>
            </div>
            <span>{result.albumTitle}</span>
          </div>
          <div className="comparison-counts" aria-label="Comparison totals">
            <article><span>You could receive</span><strong>{result.offeredCount}</strong></article>
            <article><span>You could give</span><strong>{result.wantedCount}</strong></article>
          </div>
          {result.kind === "none" ? (
            <div className="card empty-state">
              <h3>No exchange opportunities right now</h3>
              <p className="muted">The result uses both collectors’ current quantities.</p>
            </div>
          ) : (
            <div className="card trade-details">
              <TradeStickerGroup title={`${result.partnerDisplayName} can offer you`} stickers={result.offersToYou} />
              <TradeStickerGroup title={`You can offer ${result.partnerDisplayName}`} stickers={result.needsFromYou} />
            </div>
          )}
          <p className="muted comparison-disclaimer">
            This private result does not enable general trade discovery, reserve stickers, or change either collection.
          </p>
        </section>
      ) : null}
    </div>
  );
}
