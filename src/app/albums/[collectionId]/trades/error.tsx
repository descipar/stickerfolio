"use client";

import Link from "next/link";

export default function TradeMatchesError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page-shell wide-shell">
      <section className="card empty-state">
        <h2>Trade partners could not be loaded</h2>
        <p className="muted">Something went wrong while finding trade partners. Please try again.</p>
        <div className="template-actions">
          <button type="button" className="primary-button inline-action" onClick={() => reset()}>Try again</button>
          <Link className="secondary-button" href="/albums">Back to albums</Link>
        </div>
      </section>
    </main>
  );
}
