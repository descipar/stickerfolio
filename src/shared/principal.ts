/**
 * The authenticated actor a use case runs for (#126).
 *
 * The delivery layer resolves a principal (for example from a Better Auth
 * session cookie in `src/auth/principal.ts`) and passes it to module use
 * cases. Modules never read HTTP headers, cookies, or tokens themselves, so a
 * future adapter (OAuth bearer tokens for MCP, #74-#82, or a background job
 * acting for a user, #110-#113) can call the same use cases.
 *
 * A principal is only ever created for an active account. `null` means "not
 * authenticated"; use cases turn it into a 401 through the helpers below.
 */
export type PrincipalRole = "user" | "admin";

/**
 * Coarse permissions. Cookie sessions carry `"*"` (everything the account may
 * do). Narrower adapters list only what they were granted, for example
 * `"collections:read"`.
 */
export type PrincipalScope = "*" | `${string}:${"read" | "write"}`;

export interface Principal {
  readonly userId: string;
  readonly role: PrincipalRole;
  readonly mustChangePassword: boolean;
  /** The account's collector profile, if it has one. */
  readonly collectorId: string | null;
  /** The interactive session behind the principal; null for non-session adapters. */
  readonly sessionId: string | null;
  readonly scopes: readonly PrincipalScope[];
  readonly method: "session";
}

export type CollectorPrincipal = Principal & { readonly collectorId: string };

export class AuthenticationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 401,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export function hasScope(principal: Principal, scope: PrincipalScope): boolean {
  return principal.scopes.includes("*") || principal.scopes.includes(scope);
}

/** Any authenticated account, including one that still has to change its password. */
export function requirePrincipal(principal: Principal | null, scope?: PrincipalScope): Principal {
  if (!principal) throw new AuthenticationError("Authentication required.");
  if (scope && !hasScope(principal, scope)) throw new AuthenticationError("Access denied.", 403);
  return principal;
}

/** An account with a collector profile and no pending forced password change. */
export function requireCollectorPrincipal(
  principal: Principal | null,
  scope?: PrincipalScope,
): CollectorPrincipal {
  const resolved = requirePrincipal(principal, scope);
  if (resolved.mustChangePassword) throw new AuthenticationError("Password change required.", 403);
  if (!resolved.collectorId) throw new AuthenticationError("Collector profile required.", 403);
  return resolved as CollectorPrincipal;
}

/** Builds a principal; adapters use this so every principal has the same shape. */
export function createPrincipal(input: Omit<Principal, "scopes" | "method"> & {
  scopes?: readonly PrincipalScope[];
}): Principal {
  return Object.freeze({
    userId: input.userId,
    role: input.role,
    mustChangePassword: input.mustChangePassword,
    collectorId: input.collectorId,
    sessionId: input.sessionId,
    scopes: Object.freeze([...(input.scopes ?? ["*"])]),
    method: "session" as const,
  });
}
