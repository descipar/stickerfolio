import { createHash, randomBytes } from "node:crypto";

import type { Pool } from "pg";

import { getEnvironment, type RegistrationMode } from "@/infrastructure/config";
import { DatabaseError, getPool, query, withTransaction, type QueryExecutor } from "@/infrastructure/database";
import { writeLog } from "@/infrastructure/observability";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

import { normalizeEmail } from "./email";
import { hashPassword } from "./password";
import { evaluateRegistration } from "./registration";

export const defaultInvitationTtlHours = 7 * 24;
const maximumInvitationTtlHours = 30 * 24;

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export interface InvitationSummary {
  id: string;
  email: string;
  displayName: string | null;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
}

export interface CreatedInvitation {
  id: string;
  /** Plaintext token, returned exactly once. It is never stored or logged. */
  token: string;
  email: string;
  displayName: string | null;
  expiresAt: string;
}

export class InvitationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 410 | 503 = 400,
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

/** Cryptographically random, URL-safe invitation token. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * One-way hash of a high-entropy invitation token. Only the hash is persisted,
 * so a database leak never reveals a usable token, and lookups compare hashes.
 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function deriveStatus(row: {
  accepted_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date;
}): InvitationStatus {
  if (row.revoked_at) return "revoked";
  if (row.accepted_at) return "accepted";
  if (row.expires_at.getTime() <= Date.now()) return "expired";
  return "pending";
}

interface CreateInvitationInput {
  email: string;
  displayName?: string | null;
  createdByUserId: string;
  expiresInHours?: number;
}

export async function createInvitation(
  input: CreateInvitationInput,
  executor?: QueryExecutor,
): Promise<CreatedInvitation> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName?.trim() ? input.displayName.trim() : null;
  if (displayName && displayName.length > 100) {
    throw new InvitationError("The display name is too long.");
  }
  const ttlHours = Math.min(
    Math.max(1, Math.floor(input.expiresInHours ?? defaultInvitationTtlHours)),
    maximumInvitationTtlHours,
  );
  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);
  try {
    const result = await query<{ id: string; expires_at: Date }>(
      `INSERT INTO invitations (token_hash, email, display_name, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5::int))
       RETURNING id, expires_at`,
      [tokenHash, email, displayName, input.createdByUserId, ttlHours],
      executor,
    );
    const row = result.rows[0]!;
    // Only the identifier is logged; the plaintext token is never logged.
    writeLog("info", "identity.invitation_created", { invitationId: row.id });
    return {
      id: row.id,
      token,
      email,
      displayName,
      expiresAt: row.expires_at.toISOString(),
    };
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw new InvitationError("The invitation could not be created.", 503);
    }
    throw error;
  }
}

export async function listInvitations(executor?: QueryExecutor): Promise<InvitationSummary[]> {
  const result = await query<{
    id: string;
    email: string;
    display_name: string | null;
    accepted_at: Date | null;
    revoked_at: Date | null;
    expires_at: Date;
    created_at: Date;
  }>(
    `SELECT id, email, display_name, accepted_at, revoked_at, expires_at, created_at
       FROM invitations
      ORDER BY created_at DESC, id`,
    [],
    executor,
  );
  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: deriveStatus(row),
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    acceptedAt: row.accepted_at ? row.accepted_at.toISOString() : null,
  }));
}

export async function revokeInvitation(
  invitationId: string,
  executor?: QueryExecutor,
): Promise<void> {
  const result = await query(
    `UPDATE invitations SET revoked_at = now()
      WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [invitationId],
    executor,
  );
  if (result.rowCount !== 1) throw new InvitationError("The invitation is not pending.", 409);
}

/**
 * Resolves an invitation for display on the acceptance page. Returns null for
 * any invalid state (unknown, expired, revoked, or already accepted) and only
 * when the configured mode still accepts invitations, so a stale link reveals
 * nothing.
 */
export async function findValidInvitationByToken(
  token: string,
  pool: Pool = getPool(),
  mode: RegistrationMode = getEnvironment().registrationMode,
): Promise<{ email: string; displayName: string | null } | null> {
  if (!evaluateRegistration(mode).invitations || !token) return null;
  const result = await query<{
    email: string;
    display_name: string | null;
    accepted_at: Date | null;
    revoked_at: Date | null;
    expires_at: Date;
  }>(
    `SELECT email, display_name, accepted_at, revoked_at, expires_at
       FROM invitations WHERE token_hash = $1`,
    [hashInvitationToken(token)],
    pool,
  );
  const row = result.rows[0];
  if (!row || deriveStatus(row) !== "pending") return null;
  return { email: row.email, displayName: row.display_name };
}

interface AcceptInvitationInput {
  token: string;
  password: string;
  displayName?: string;
}

/**
 * Atomically accepts an invitation. Available only in invitation mode. The
 * invitation row is locked FOR UPDATE and re-validated inside the transaction,
 * so concurrent acceptances of the same token serialize and exactly one wins;
 * the others observe the recorded acceptance and are rejected. On success the
 * Better Auth user, its credential account, and the collector profile are
 * created and the invitation is marked accepted – all in the one transaction,
 * so an invalid or losing attempt changes no data. The login email always comes
 * from the invitation, never from client input.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
  pool: Pool = getPool(),
  mode: RegistrationMode = getEnvironment().registrationMode,
): Promise<{ userId: string; email: string }> {
  if (!evaluateRegistration(mode).invitations) {
    throw new InvitationError("Invitation registration is not enabled.", 404);
  }
  if (
    input.password.length < minimumPasswordLength ||
    input.password.length > maximumPasswordLength
  ) {
    throw new InvitationError(
      `Passwords must contain ${minimumPasswordLength} through ${maximumPasswordLength} characters.`,
    );
  }
  const tokenHash = hashInvitationToken(input.token);
  const passwordHash = await hashPassword(input.password);
  try {
    return await withTransaction(async (client) => {
      const invitation = await query<{
        id: string;
        email: string;
        display_name: string | null;
        accepted_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT id, email, display_name, accepted_at, revoked_at, expires_at
           FROM invitations WHERE token_hash = $1 FOR UPDATE`,
        [tokenHash],
        client,
      );
      const row = invitation.rows[0];
      if (!row || deriveStatus(row) !== "pending") {
        throw new InvitationError("This invitation link is not valid or has expired.", 410);
      }
      const displayName = (input.displayName?.trim() || row.display_name || "").trim();
      if (displayName.length < 1 || displayName.length > 100) {
        throw new InvitationError("A display name is required.");
      }
      const user = await query<{ id: string }>(
        `INSERT INTO "user" (name, email, "emailVerified", "mustChangePassword", role, status)
         VALUES ($1, $2, true, false, 'user', 'active') RETURNING id`,
        [displayName, row.email],
        client,
      );
      const userId = user.rows[0]!.id;
      await query(
        `INSERT INTO account ("accountId", "providerId", "userId", password, "createdAt", "updatedAt")
         VALUES ($1, 'credential', $2, $3, now(), now())`,
        [userId, userId, passwordHash],
        client,
      );
      await query(
        "INSERT INTO collector_profiles (user_id, display_name) VALUES ($1, $2)",
        [userId, displayName],
        client,
      );
      await query(
        `UPDATE invitations SET accepted_at = now(), accepted_by_user_id = $2 WHERE id = $1`,
        [row.id, userId],
        client,
      );
      writeLog("info", "identity.invitation_accepted", { invitationId: row.id, userId });
      return { userId, email: row.email };
    }, pool);
  } catch (error) {
    if (error instanceof InvitationError) throw error;
    if (error instanceof DatabaseError && error.code === "23505") {
      throw new InvitationError("An account already exists for this invitation.", 409);
    }
    if (error instanceof DatabaseError) {
      throw new InvitationError("The service is temporarily unavailable.", 503);
    }
    throw error;
  }
}
