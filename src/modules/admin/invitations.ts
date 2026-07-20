import type { Pool } from "pg";

import { getPool } from "@/infrastructure/database";
import { writeAuditEvent } from "@/infrastructure/observability";
import {
  createInvitation,
  evaluateRegistration,
  listInvitations,
  revokeInvitation,
  type CreatedInvitation,
  type InvitationSummary,
  type RegistrationAvailability,
  type RegistrationMode,
  type StickerfolioAuth,
} from "@/modules/identity";

import { AdminError, requireAdmin } from "./users";

function ensureInvitationMode(mode?: RegistrationMode): void {
  if (!evaluateRegistration(mode).invitations) {
    throw new AdminError("Invitations are available only in invitation registration mode.", 409);
  }
}

/** Active registration configuration for display in the admin area. */
export function getRegistrationAvailability(mode?: RegistrationMode): RegistrationAvailability {
  return evaluateRegistration(mode);
}

interface CreateAdminInvitationInput {
  email: string;
  displayName?: string | null;
  expiresInHours?: number;
}

export async function createAdminInvitation(
  headers: Headers,
  input: CreateAdminInvitationInput,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
  mode?: RegistrationMode,
): Promise<CreatedInvitation> {
  const actor = await requireAdmin(headers, auth, pool);
  ensureInvitationMode(mode);
  const invitation = await createInvitation({ ...input, createdByUserId: actor.userId }, pool);
  writeAuditEvent(
    "invitation.created",
    { type: "user", userId: actor.userId },
    { type: "invitation", id: invitation.id },
  );
  return invitation;
}

export async function listAdminInvitations(
  headers: Headers,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<InvitationSummary[]> {
  await requireAdmin(headers, auth, pool);
  return listInvitations(pool);
}

export async function revokeAdminInvitation(
  headers: Headers,
  invitationId: string,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = await requireAdmin(headers, auth, pool);
  await revokeInvitation(invitationId, pool);
  writeAuditEvent(
    "invitation.revoked",
    { type: "user", userId: actor.userId },
    { type: "invitation", id: invitationId },
  );
}
