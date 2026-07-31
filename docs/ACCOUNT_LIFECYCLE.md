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
       │    ├─ holdings              (CASCADE)
       │    └─ collection_share_links (CASCADE)
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
- **Last active-administrator guard.** Deletion, self-service deactivation,
  administrator suspension, and administrator demotion share one transactional
  locking protocol (`lockAdministratorsForMutation`). Each acquires the same
  `SELECT ... WHERE role = 'admin' FOR UPDATE` administrator-row lock **before**
  checking and mutating, so concurrent mutations serialize and cannot jointly
  leave the installation without an active administrator. A removing mutation is
  refused when the target is an administrator and no **other** administrator with
  `status = 'active'` would remain. Only active administrators count: a suspended
  administrator cannot sign in, so it cannot reactivate anyone. This means the
  sole active administrator cannot delete, deactivate, suspend, or demote itself
  or the last other active administrator even when a suspended administrator
  still exists — otherwise nobody could sign in to reactivate that suspended
  administrator. This preserves the guarantee that the bootstrap administrator is
  never left un-recreatable (Roadmap 11.4). Administrators delete their own
  account from account settings, not from the management panel.
- **Revalidation after locking.** For administrator-panel operations the acting
  administrator is revalidated against the freshly locked snapshot after the lock
  is taken: they must still exist and still be an **active** administrator. The
  HTTP-layer `requireAdmin` check ran earlier and can be stale, because a
  concurrent mutation could have deleted, suspended, or demoted the actor while
  this already-authorized request waited on the lock. Reactivation and promotion
  only add administrator capacity, so they take the lock and revalidate the actor
  but do not enforce the last-administrator invariant.

### Invitations

Invitation-based registration (#87) is merged, so the `invitations` table is
present and `invitations.created_by_user_id` is NULLABLE with
`ON DELETE SET NULL`. Deleting a user therefore does **not** cascade-delete the
invitations they created: their pending invitations survive with the creator
cleared to `NULL`, and accepted-invitation records keep their acceptor while the
creator link is cleared. This is called out in code comments next to both the
administrator and self-service delete use cases, and the combined
deletion-with-pending/accepted-invitations behaviour is covered by the
account-lifecycle integration tests.

## Data export before deletion

The account-deletion flow surfaces an **export-first** step with a single,
versioned JSON download. The file contains the signed-in user's non-sensitive
account fields, collector profile, trading preference, every personal
collection, every sticker quantity from zero through 99, and token-free
share-link metadata. It therefore preserves missing stickers, owned single
copies, duplicates, and the history of which list scopes were shared. Deletion
is standalone and never blocks on export.

The per-collection CSV export (issue #68) remains a focused missing or duplicate
list. It deliberately omits owned single copies, profile/account fields and a
single all-collections document, so it is not treated as the data-preservation
export.

The complete export is derived exclusively from the authenticated session. It
does not accept a user or collector identifier and excludes password hashes,
sessions, authentication and invitation tokens, share-token hashes, plaintext
share tokens, and every other user's data.

Administrators cannot export another user's data because administrators have no
access to other users' holdings (Roadmap 8.2 / 20.4); the admin delete dialog
instead asks the administrator to have the user export first.

## Audit and data minimization

Suspension, deactivation, and deletion emit structured `security.audit` events
through the shared logger. Events record only the action, the actor user id,
and the target user id. Emails, passwords, tokens, and holdings are never
logged; the logger additionally redacts sensitive keys defensively.
