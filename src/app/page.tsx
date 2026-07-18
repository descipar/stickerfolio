const foundation = ["Next.js 16", "TypeScript", "pnpm 11"];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Greenfield foundation</p>
        <h1 id="page-title">Stickerfolio v2</h1>
        <p className="intro">
          The new multi-user sticker album tracker starts here. Product features
          will be added incrementally through the project roadmap.
        </p>
        <ul className="foundation" aria-label="Foundation technologies">
          {foundation.map((technology) => (
            <li key={technology}>{technology}</li>
          ))}
        </ul>
      </section>

      <section className="status" aria-labelledby="status-title">
        <div>
          <p className="status-label">Current status</p>
          <h2 id="status-title">Foundation ready</h2>
        </div>
        <span className="status-badge">Issue #1</span>
      </section>
    </main>
  );
}
