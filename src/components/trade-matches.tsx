"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface TradeSection { id: string; code: string; name: string }
interface TradeSticker {
  code: string;
  partnerCode: string;
  label: string;
  section: TradeSection;
  spareCount: number;
}
interface TradeMatch {
  displayName: string;
  kind: "one-way" | "two-way";
  offersToYou: TradeSticker[];
  needsFromYou: TradeSticker[];
  offeredCount: number;
  wantedCount: number;
}
interface TradeResponse {
  collection: { id: string; albumTitle: string };
  enabled: boolean;
  sections: TradeSection[];
  matches: TradeMatch[];
  total: number;
  limit: number;
  offset: number;
}

function StickerList({ title, stickers }: { title: string; stickers: TradeSticker[] }) {
  return (
    <div className="trade-sticker-group">
      <h3>{title} <span className="count-badge">{stickers.length}</span></h3>
      {stickers.length === 0 ? <p className="muted">No matching stickers in this direction.</p> : (
        <ul className="trade-sticker-list">
          {stickers.map((sticker) => (
            <li key={`${sticker.code}-${sticker.partnerCode}`}>
              <span><strong>{sticker.code}</strong><small>{sticker.section.name}</small></span>
              {sticker.partnerCode !== sticker.code ? <span className="partner-code">Their code: {sticker.partnerCode}</span> : null}
              <span className="spare-count">{sticker.spareCount} spare</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TradeMatches({ collectionId }: { collectionId: string }) {
  const [direction, setDirection] = useState("all");
  const [section, setSection] = useState("");
  const [sort, setSort] = useState("compatibility");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<TradeResponse | null>(null);
  const [error, setError] = useState("");
  const limit = 20;

  const query = useMemo(() => new URLSearchParams({
    direction,
    section,
    sort,
    limit: String(limit),
    offset: String(offset),
  }).toString(), [direction, offset, section, sort]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/collections/${collectionId}/trades?${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setData(null);
          setError(response.status === 404 ? "Album not found." : "Trade matches could not be loaded.");
          return;
        }
        setError("");
        setData(await response.json() as TradeResponse);
      })
      .catch(() => {
        if (!active) return;
        setData(null);
        setError("Trade matches could not be loaded.");
      });
    return () => { active = false; };
  }, [collectionId, query]);

  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setOffset(0);
  }

  if (!data && !error) return <p className="state-message" role="status">Finding trade partners…</p>;
  if (error) return <p className="state-message error" role="alert">{error}</p>;
  if (!data) return null;

  return (
    <div className="trade-view content-stack">
      <section className="overview-intro">
        <p className="eyebrow">Trading</p>
        <h1 className="overview-title">Trade matches</h1>
        <p className="overview-subtitle">{data.collection.albumTitle} · only relevant stickers from opted-in collectors are shown.</p>
      </section>

      {!data.enabled ? (
        <section className="card empty-state">
          <h2>Trading is private</h2>
          <p className="muted">Enable trade matching in your account before viewing or appearing in matches.</p>
          <Link className="primary-button inline-action" href="/account">Open trading preference</Link>
        </section>
      ) : (
        <>
          <section className="trade-filters card" aria-label="Filter and sort trade matches">
            <label>Match type
              <select value={direction} onChange={(event) => changeFilter(setDirection, event.target.value)}>
                <option value="all">All matches</option>
                <option value="two-way">Two-way matches</option>
                <option value="one-way">One-way matches</option>
              </select>
            </label>
            <label>Team or section
              <select value={section} onChange={(event) => changeFilter(setSection, event.target.value)}>
                <option value="">All sections</option>
                {data.sections.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
              </select>
            </label>
            <label>Sort by
              <select value={sort} onChange={(event) => changeFilter(setSort, event.target.value)}>
                <option value="compatibility">Best compatibility</option>
                <option value="offered">Most offered to you</option>
                <option value="wanted">Most wanted from you</option>
                <option value="name">Collector name</option>
              </select>
            </label>
          </section>

          <div className="results-heading">
            <div><p className="eyebrow">Partners</p><h2>{data.total} matches</h2></div>
            <span>{data.total === 0 ? "0" : `${data.offset + 1}-${Math.min(data.offset + data.matches.length, data.total)}`} of {data.total}</span>
          </div>

          {data.matches.length === 0 ? (
            <section className="card empty-state"><h2>No trade matches</h2><p className="muted">Try another section or match type, or check again after collections change.</p></section>
          ) : (
            <section className="trade-match-list" aria-label="Trade partners">
              {data.matches.map((match, index) => (
                <article className="card trade-match-card" key={`${match.displayName}-${index}`}>
                  <header><div><p className="eyebrow">{match.kind === "two-way" ? "Two-way match" : "One-way match"}</p><h2>{match.displayName}</h2></div><span className="status-badge">{match.offeredCount + match.wantedCount} stickers</span></header>
                  <StickerList title="They can offer you" stickers={match.offersToYou} />
                  <StickerList title="You can offer them" stickers={match.needsFromYou} />
                </article>
              ))}
            </section>
          )}

          {data.total > limit ? (
            <nav className="trade-pagination" aria-label="Trade match pages">
              <button className="secondary-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</button>
              <button className="secondary-button" disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)}>Next</button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
