import Link from "next/link";
import { getDashboard } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const { collector, albums } = getDashboard();
  const totals = albums.reduce((sum, album) => ({ total: sum.total + album.total, owned: sum.owned + album.owned, missing: sum.missing + album.missing, doubles: sum.doubles + album.extraDuplicates }), { total: 0, owned: 0, missing: 0, doubles: 0 });

  return (
    <div className="stack page-enter">
      <section className="hero">
        <p className="eyebrow">Hallo {collector.name}</p>
        <h1>Deine Stickeralben</h1>
        <p className="muted">Schnell abhaken, Doubletten zählen und den Fortschritt im Blick behalten.</p>
      </section>

      <section className="stat-grid" aria-label="Gesamtübersicht">
        <div className="stat-card stat-primary"><span>Gesammelt</span><strong>{totals.owned}</strong><small>von {totals.total}</small></div>
        <div className="stat-card"><span>Fehlen</span><strong>{totals.missing}</strong><small>Sticker</small></div>
        <div className="stat-card"><span>Doubletten</span><strong>{totals.doubles}</strong><small>Exemplare</small></div>
      </section>

      <section className="section-heading">
        <div><p className="eyebrow">Sammlung</p><h2>Alben</h2></div>
        <Link href="/albums/new" className="button button-secondary">+ Album</Link>
      </section>

      <div className="album-grid">
        {albums.length === 0 && (
          <section className="empty-state">
            <span aria-hidden="true">＋</span>
            <h3>Noch kein Album vorhanden</h3>
            <p>Importiere einen Stickerkatalog oder lade einen vorbereiteten Startbestand per Skript.</p>
            <Link href="/albums/new" className="button button-primary">Erstes Album anlegen</Link>
          </section>
        )}
        {albums.map((album) => {
          const percent = album.total ? Math.round((album.owned / album.total) * 100) : 0;
          return (
            <Link href={`/albums/${album.id}`} className="album-card" key={album.id}>
              <div className="album-cover" aria-hidden="true"><span>★</span><b>2026</b></div>
              <div className="album-info">
                <div><h3>{album.name}</h3><p>{album.description}</p></div>
                <div className="progress-row"><span>{album.owned} / {album.total}</span><strong>{percent}%</strong></div>
                <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
                <div className="album-meta"><span>{album.missing} fehlen</span><span>{album.extraDuplicates} doppelt</span></div>
              </div>
              <span className="chevron" aria-hidden="true">›</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
