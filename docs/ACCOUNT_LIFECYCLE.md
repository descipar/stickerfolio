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
- **Last-administrator guard.** All administrator rows are locked `FOR UPDATE`
  and deletion (or deactivation) is refused when the target is the only
  administrator. This preserves the guarantee that the bootstrap administrator
  is never left un-recreatable (Roadmap 11.4). Administrators delete their own
  account from account settings, not from the management panel.

### Invitations (forward note)

Invitation-based registration is not yet on `main`. When it lands, its
`invitations.created_by_user_id` and `accepted_by_user_id` references must use
`ON DELETE SET NULL` (or be cleared inside the deletion transaction) so account
deletion keeps cascading cleanly and an accepted invitation record survives the
removal of its creator. This is called out in code comments next to the delete
use cases.

## Data export before deletion

Users should export their collections before deleting. The account page links
to the albums overview, where the per-collection CSV export (issue #68) is
available. Deletion is standalone and never blocks on export. Administrators
cannot export another user's data because administrators have no access to
other users' holdings (Roadmap 8.2 / 20.4); the admin delete dialog instead
asks the administrator to have the user export first.

## Audit and data minimization

Suspension, deactivation, and deletion emit structured `security.audit` events
through the shared logger. Events record only the action, the actor user id,
and the target user id. Emails, passwords, tokens, and holdings are never
logged; the logger additionally redacts sensitive keys defensively.
