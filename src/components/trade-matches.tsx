"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type {
  TradeDirection,
  TradeMatch,
  TradeMatchResult,
  TradeSort,
  TradeSticker,
} from "@/modules/trading";

import { buildTradeQuery, describeMatch, formatRange, pageCount } from "./trade-summary";

interface TradeFilters {
  direction: TradeDirection;
  section: string;
  sort: TradeSort;
}

const STICKER_PREVIEW = 8;

function StickerGroup({ title, stickers }: { title: string; stickers: TradeSticker[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? stickers : stickers.slice(0, STICKER_PREVIEW);

  return (
    <div className="trade-sticker-group">
      <h3>
        {title} <span className="count-badge">{stickers.length}</span>
      </h3>
      {stickers.length === 0 ? (
        <p className="muted">No stickers in this direction.</p>
      ) : (
        <>
          <ul className="trade-sticker-list">
            {visible.map((sticker) => (
              <li key={`${sticker.code}-${sticker.partnerCode}`}>
                <span>
                  <strong>{sticker.code}</strong>
                  <small>{sticker.section.code} · {sticker.section.name}</small>
                </span>
                {sticker.partnerCode !== sticker.code ? (
                  <span className="partner-code">Their code: {sticker.partnerCode}</span>
                ) : null}
                <span className="spare-count">{sticker.spareCount} spare</span>
              </li>
            ))}
          </ul>
          {stickers.length > STICKER_PREVIEW ? (
            <button
              type="button"
              className="text-button"
              aria-expanded={showAll}
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? "Show fewer" : `Show all ${stickers.length}`}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function PartnerCard({ match, index }: { match: TradeMatch; index: number }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();

  return (
    <article className="card trade-match-card">
      <button
        type="button"
        className="trade-toggle"
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={describeMatch(match)}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="trade-toggle-copy">
          <span className={`status-badge ${match.kind === "two-way" ? "two-way" : "one-way"}`}>
            {match.kind === "two-way" ? "Two-way" : "One-way"}
          </span>
          <strong>{match.displayName}</strong>
        </span>
        <span className="trade-toggle-counts">
          <span className="count-badge" title="Stickers you could receive">↓ {match.offeredCount} receive</span>
          <span className="count-badge" title="Stickers you could give">↑ {match.wantedCount} give</span>
          <span className="trade-caret" aria-hidden="true">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open ? (
        <div className="trade-details" id={detailsId}>
          <StickerGroup title="They can offer you" stickers={match.offersToYou} />
          <StickerGroup title="You can offer them" stickers={match.needsFromYou} />
        </div>
      ) : (
        <p className="muted trade-hint" aria-hidden="true">Tap to see the {match.offeredCount + match.wantedCount} matching stickers.</p>
      )}
      <span className="visually-hidden">Partner {index + 1}</span>
    </article>
  );
}

export function TradeMatches({
  result,
  filters,
  page,
  pageSize,
}: {
  result: TradeMatchResult;
  filters: TradeFilters;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function apply(next: TradeFilters, nextPage: number) {
    const query = buildTradeQuery(next, nextPage);
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  function changeFilter(patch: Partial<TradeFilters>) {
    apply({ ...filters, ...patch }, 1);
  }

  const totalPages = pageCount(result.total, pageSize);

  return (
    <div className="trade-view content-stack" aria-busy={isPending}>
      <section className="overview-intro">
        <p className="eyebrow">Trading</p>
        <h1 className="overview-title">Trade partners</h1>
        <p className="overview-subtitle">
          {result.collection.albumTitle} · only opted-in collectors and the stickers relevant to a possible
          trade are shown. This view never changes your collection.
        </p>
      </section>

      {!result.enabled ? (
        <section className="card empty-state">
          <h2>Trading is private</h2>
          <p className="muted">
            Opt in to trade matching in your account before you can see partners or appear in their matches.
          </p>
          <Link className="primary-button inline-action" href="/account">Open trading preference</Link>
        </section>
      ) : (
        <>
          <section className="trade-filters card" aria-label="Filter and sort trade partners">
            <label>Match type
              <select
                value={filters.direction}
                disabled={isPending}
                onChange={(event) => changeFilter({ direction: event.target.value as TradeDirection })}
              >
                <option value="all">All matches</option>
                <option value="two-way">Two-way matches</option>
                <option value="one-way">One-way matches</option>
              </select>
            </label>
            <label>Team or section
              <select
                value={filters.section}
                disabled={isPending}
                onChange={(event) => changeFilter({ section: event.target.value })}
              >
                <option value="">All sections</option>
                {result.sections.map((item) => (
                  <option key={item.id} value={item.id}>{item.code} · {item.name}</option>
                ))}
              </select>
            </label>
            <label>Sort by
              <select
                value={filters.sort}
                disabled={isPending}
                onChange={(event) => changeFilter({ sort: event.target.value as TradeSort })}
              >
                <option value="compatibility">Best compatibility</option>
                <option value="offered">Most offered to you</option>
                <option value="wanted">Most wanted from you</option>
                <option value="name">Collector name</option>
              </select>
            </label>
          </section>

          <div className="results-heading">
            <div>
              <p className="eyebrow">Partners</p>
              <h2>{result.total} {result.total === 1 ? "match" : "matches"}</h2>
            </div>
            <span aria-live="polite">
              {isPending ? "Updating…" : formatRange(result.offset, result.matches.length, result.total)}
            </span>
          </div>

          {result.matches.length === 0 ? (
            <section className="card empty-state">
              <h2>No trade partners yet</h2>
              <p className="muted">
                Try another section or match type, or check again once collections change.
              </p>
            </section>
          ) : (
            <section className="trade-match-list" aria-label="Trade partners">
              {result.matches.map((match, index) => (
                <PartnerCard key={`${match.displayName}-${result.offset + index}`} match={match} index={index} />
              ))}
            </section>
          )}

          {totalPages > 1 ? (
            <nav className="trade-pagination" aria-label="Trade partner pages">
              <button
                type="button"
                className="secondary-button"
                disabled={page <= 1 || isPending}
                onClick={() => apply(filters, page - 1)}
              >
                Previous
              </button>
              <span className="muted">Page {page} of {totalPages}</span>
              <button
                type="button"
                className="secondary-button"
                disabled={page >= totalPages || isPending}
                onClick={() => apply(filters, page + 1)}
              >
                Next
              </button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
