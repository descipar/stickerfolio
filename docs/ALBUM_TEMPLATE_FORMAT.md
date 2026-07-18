# Portable album template format

Album catalogs are portable JSON-compatible documents validated independently of PostgreSQL, Docker, or a hosting provider. Format version `1` separates shared catalog structure from all user accounts, collections, and holdings.

```json
{
  "formatVersion": 1,
  "album": {
    "id": "16cdf0a0-d4d7-5e58-8e49-f2c8455be4fb",
    "slug": "example-album",
    "title": "Example album",
    "description": "Optional description"
  },
  "revision": {
    "id": "017b7165-f89f-55aa-a2ca-4139b59bfbca",
    "number": 1,
    "label": "First edition",
    "status": "published"
  },
  "sections": [
    {
      "id": "26bdb46d-24f4-59f1-ae22-343473f7baef",
      "code": "EX",
      "name": "Example section",
      "sortOrder": 0
    }
  ],
  "stickers": [
    {
      "stableId": "06cdf614-184d-5e91-a65f-3f9d40f5fb50",
      "stableKey": "example-1",
      "sectionId": "26bdb46d-24f4-59f1-ae22-343473f7baef",
      "code": "EX1",
      "label": "Example sticker",
      "sortOrder": 0
    }
  ]
}
```

All IDs are UUIDs. `album.id` identifies the logical album across installations. A sticker's `stableId` and `stableKey` identify the same physical sticker across catalog revisions even when its printed code, label, order, or section changes. Revision and section IDs identify revision-specific structure.

Section codes and order values must be unique within the revision. Sticker stable IDs, stable keys, codes, and order values must also be unique. Every sticker must reference a section in the same document. The runtime validator reports the exact invalid path and rejects the entire document before database work begins.

Templates contain no login email, password, collector profile, personal collection, or holding quantity. Personal example data belongs in a separate, explicit holdings seed.
