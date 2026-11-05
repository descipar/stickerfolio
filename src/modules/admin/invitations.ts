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
} from "@/modules/identity";
import type { Principal } from "@/shared/principal";

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
  principal: Principal | null,
  input: CreateAdminInvitationInput,
  pool: Pool = getPool(),
  mode?: RegistrationMode,
): Promise<CreatedInvitation> {
  const actor = requireAdmin(principal);
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
  principal: Principal | null,
  pool: Pool = getPool(),
): Promise<InvitationSummary[]> {
  requireAdmin(principal);
  return listInvitations(pool);
}

export async function revokeAdminInvitation(
  principal: Principal | null,
  invitationId: string,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = requireAdmin(principal);
  await revokeInvitation(invitationId, pool);
  writeAuditEvent(
    "invitation.revoked",
    { type: "user", userId: actor.userId },
    { type: "invitation", id: invitationId },
  );
}
