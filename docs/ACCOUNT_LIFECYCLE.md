# Account lifecycle

This document defines the three account lifecycle states and the permanent
deletion of an account, together with their effect on sessions, related data,
and the audit trail. It implements issue #35 and Roadmap sections 7 (data
model), 8.2 (administrator), 10.3 (privacy), and 11 (initialization).

## States and actions

| Action | Who | Reversible | `user.status` | Sessions | Sign-in |
| --- | --- | --- | --- | --- | --- |
| Suspend | Administrator | Yes (admin reactivates) | `suspended` | revoked | blocked |
| Deactivate | Account owner | Yes (admin reactivates) | `suspended` | revoked | blocked |
| Reactivate | Administrator | — | `active` | — | allowed |
| Delete | Administrator or owner | No | row removed | revoked (cascade) | blocked |

The account status is stored on the existing `user.status` column
(`active` | `suspended`, migration `000003`). No new column or enum value is
introduced: **deactivation is the self-service sibling of an administrator
suspension** and reuses the same status and session-revocation path. Because a
suspended account cannot sign in, a deactivated user is reactivated by an
administrator.

## Suspension and deactivation

- Both set `status = 'suspended'` and revoke every active session with
  `DELETE FROM session WHERE "userId" = $1`, the same pattern used on password
  reset and email change.
- Sign-in is blocked in two places: the Better Auth `session.create.before`
  hook refuses to create a session for a non-active user, and `resolveIdentity`
  returns `null` for a non-active user, so existing requests stop resolving to
  an identity immediately.
- Collections, holdings, collector profile, and trading preferences are kept
  unchanged so the account can be restored intact.
- Deactivation requires the current password so the action is deliberate.

## Permanent deletion

Deletion is irreversible and runs as a single transaction. It removes the user
row; every dependent row is removed by `ON DELETE CASCADE` foreign keys:

```
user
  ├─ session            (CASCADE)
  ├─ account            (CASCADE)
  └─ collector_profiles (CASCADE)
       ├─ collections   (CASCADE)
       │    └─ holdings (CASCADE)
       └─ trading_preferences (CASCADE)
```

- **No foreign key is violated.** The shared catalog (albums, revisions,
  stickers) is referenced from `collections` and `holdings` with
  `ON DELETE RESTRICT`. That restricts deleting *catalog* rows, not the user's
  own collection or holding rows, so removing a user never touches shared data.
- **No other user is affected.** Only rows reachable from the target user are
  removed; the deletion is keyed solely on the user id.
- **Deliberate confirmation.** The caller must supply the exact login email
  (and, for the self-service path, the current password). Both are verified
  server-side; hiding a UI control is never the guard.
- **Last active-administrator guard.** All administrator rows are locked
  `FOR UPDATE` and deletion (or deactivation) is refused when the target is an
  administrator and no **other** administrator with `status = 'active'` would
  remain. Only active administrators count: a suspended administrator cannot
  sign in, so it cannot reactivate anyone. This means the sole active
  administrator cannot delete or deactivate itself even when a suspended
  administrator still exists — otherwise nobody could sign in to reactivate that
  suspended administrator. This preserves the guarantee that the bootstrap
  administrator is never left un-recreatable (Roadmap 11.4). Administrators
  delete their own account from account settings, not from the management panel.

### Invitations (forward note)

Invitation-based registration is not on this branch (milestone M1 is not yet
merged), so the `invitations` table is intentionally absent here and no
invitation code is referenced. The agreed data policy, aligned with PR #87
(M1): `invitations.created_by_user_id` becomes NULLABLE with
`ON DELETE SET NULL`, so deleting an administrator does **not** cascade-delete
their pending invitations, and accepted-invitation records survive the removal
of their creator. This is called out in code comments next to the delete use
cases. The combined deletion-with-pending/accepted-invitations integration test
will be added once M1 (#87) merges.

## Data export before deletion

Acceptance interpretation (revised in review of PR #86): the account-deletion
flow **surfaces an export-first step**, and a **complete, portable
account-data export is tracked in issue #88**. Deletion is standalone and never
blocks on export.

The per-collection CSV export (issue #68) only produces missing and duplicate
lists; it deliberately omits owned single copies, profile/account fields, and a
single all-collections file, so it is **not** a full export and is not treated
as the data-preservation export. Issue #88 ("Complete self-service account data
export") tracks the complete portable export that will become the real
"export first" target and supersedes the export-before-deletion acceptance
point of #35.

Administrators cannot export another user's data because administrators have no
access to other users' holdings (Roadmap 8.2 / 20.4); the admin delete dialog
instead asks the administrator to have the user export first.

## Audit and data minimization

Suspension, deactivation, and deletion emit structured `security.audit` events
through the shared logger. Events record only the action, the actor user id,
and the target user id. Emails, passwords, tokens, and holdings are never
logged; the logger additionally redacts sensitive keys defensively.
