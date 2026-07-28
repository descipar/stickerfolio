# User guide

## Accounts and onboarding

An installation can use closed, invitation-only, or open registration. New accounts must change an administrator-assigned temporary password at first sign-in. Depending on the registration mode, onboarding asks for a collector display name and one or more available album templates.

Each account sees and changes only its own personal collections. Administrators manage accounts, registration, and shared album templates but do not receive blanket access to collector holdings or trade results.

Users can change their login email from **Account** after confirming the current password. A successful change revokes all sessions. Administrators can correct another user's login email from **Users**.

Account deactivation, permanent deletion, administrator suspension, last-administrator safeguards, and export-before-deletion behavior are documented in [Account lifecycle](ACCOUNT_LIFECYCLE.md).

## Personal collections

After an administrator publishes an album template, a collector can add it as a personal album. Each personal collection remains pinned to the selected catalog revision.

Inside an album:

- search by sticker code or section/team name;
- filter by section and missing, owned, or duplicate status;
- set a quantity to zero for missing, one for owned, or above one for duplicates;
- review global and per-section progress.

Quantities range from zero through 99. Only the amount above one is available as a spare copy.

## CSV exports

Each personal album provides two separate exports:

- **Missing list** contains every sticker with quantity zero.
- **Duplicates list** contains only quantities above one and reports both total quantity and spare count.

Exports are scoped to the signed-in collector and one selected personal album. They do not include another collector's holdings. These focused files are intended for wanted and swap lists; they are not a complete account backup.

## Complete account export

The account danger zone provides one versioned JSON download containing the signed-in user's
non-sensitive account fields, collector profile, trading preference, every personal collection,
and every sticker quantity from zero through 99. It includes missing stickers, owned single
copies, and duplicates in one portable file.

The export never contains password hashes, sessions, tokens, invitations, or another user's
data. Download it before permanent account deletion if you want to retain a complete copy.

## Trade matching

Trade matching is disabled by default. Enable **Appear in trade matching** under **Account** to participate. Disabling the option immediately removes the collector from other users' results and hides their own results.

Open a personal album and select **Find trade partners**. Stickerfolio compares stable sticker identities for active collections of the same logical album:

- a partner can offer a sticker when the current collector has zero and the partner owns more than one;
- the current collector can offer a sticker when they own more than one and the partner has zero;
- a two-way match helps both collectors;
- a one-way match helps only one side.

Results can be filtered by section and match type and sorted by compatibility, offered stickers, wanted stickers, or collector name. Partner rows expand to show the relevant codes, sections, revision-specific partner codes, and spare counts.

Matching is private and read-only. Results contain only the partner display name and relevant stickers. They never expose login email addresses, unrelated holdings, or complete collections, and they never reserve or transfer a sticker.

## Album templates

Administrators can upload a portable JSON template or generate a small starter template in the browser. Imports are validated atomically and always enter as drafts. Publishing a new revision archives the previous published revision, while existing personal collections remain unchanged.

The provider-neutral format and stable identity rules are documented in [Portable album template format](ALBUM_TEMPLATE_FORMAT.md).
