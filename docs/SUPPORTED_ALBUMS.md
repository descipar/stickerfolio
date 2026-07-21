# Supported album catalogs

Stickerfolio can import arbitrary catalogs that follow the portable album template format. The repository also ships with the following reviewed catalogs that can be loaded idempotently with `pnpm seed:catalogs`.

## Panini FIFA World Cup 2026

- Slug: `panini-world-cup-2026`
- Revision: `2026 checklist edition`
- Scope: 994 stickers in 50 sections
- Structure: 48 teams plus tournament and sponsor sections

## Topps UEFA EURO 2024

- Slug: `topps-uefa-euro-2024-standard-de`
- Revision: `Standard German edition`
- Scope: 707 physical sticker carriers in 43 sections
- Structure: tournament, host cities, six group overviews, 21 full team sections, 12 reduced play-off team sections, Dream Team, and Legends

The EURO 2024 catalog deliberately uses a physical carrier sheet as the collection and trading unit. For example, `POL2+3`, `GA1+2`, and `MM1+2` each represent one carrier containing two smaller stickers. This produces 707 quantities that correspond to items collectors can own or exchange; counting every smaller sticker separately would produce 798 album images.

Topps advertised 728 stickers because that total also counted 21 Star Player Signature alternatives. Signature stickers and the other foil, color, Black, Gold, and regional parallel variants are not additional requirements for completing the standard album and are therefore not separate items in this revision. A future variant-tracking feature can model them without changing the base album's completion rules.

The catalog represents the standard German edition. A materially different regional edition, such as the Swiss edition, must use a separate album or revision after its contents have been verified rather than being mixed into this catalog.

Sources used to reconcile the unusual numbering and counts:

- [Topps UEFA EURO 2024 product description](https://de.topps.com/products/official-euro-2024-sticker-collection-full-box-100-packchen-vorbestellung)
- [Sticker-Tauschbörse overview and carrier-sheet checklist](https://sticker-tauschboerse.com/was-ihr-ueber-die-topps-uefa-euro-2024-sticker-wissen-muesst/)
- [Collectosk checklist and count explanation](https://www.collectosk.com/topps-uefa-euro-2024-sticker/)

Catalog files contain codes and section names only. They do not redistribute sticker artwork or player photographs.
