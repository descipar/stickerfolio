import { writeLog } from "./logger";

export type AuditAction =
  | "account.created"
  | "account.password_reset"
  | "account.role_changed"
  | "account.status_changed"
  | "album_revision.published"
  | "album_revision.archived"
  | "invitation.created"
  | "invitation.revoked"
  | "registration_mode.configured";

type AuditActor =
  | { type: "user"; userId: string }
  | { type: "system" };

export function writeAuditEvent(
  action: AuditAction,
  actor: AuditActor,
  target: { type: "user" | "album_revision" | "invitation" | "registration_mode"; id: string },
  details: Record<string, string | boolean | number | null> = {},
): void {
  writeLog("info", "security.audit", {
    audit: {
      action,
      actorType: actor.type,
      actorUserId: actor.type === "user" ? actor.userId : null,
      targetType: target.type,
      targetId: target.id,
      details,
    },
  });
}
