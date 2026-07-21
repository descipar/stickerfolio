import type { Pool } from "pg";

import { getEnvironment, type RegistrationMode } from "@/infrastructure/config";
import { DatabaseError, getPool, query, withTransaction } from "@/infrastructure/database";
import { writeLog } from "@/infrastructure/observability";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

import { normalizeEmail } from "./email";
import { hashPassword } from "./password";

export type { RegistrationMode };

/**
 * Central evaluation of the configured registration mode. All registration
 * entry points (open self-registration, invitation acceptance, and the admin
 * area display) derive their behaviour from this single source so the server
 * rules always match the visible UI. The mode itself comes from the existing
 * typed environment configuration (REGISTRATION_MODE); this module never adds a
 * second configuration source.
 */
export interface RegistrationAvailability {
  mode: RegistrationMode;
  openRegistration: boolean;
  invitations: boolean;
}

export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503 = 400,
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}

export function evaluateRegistration(
  mode: RegistrationMode = getEnvironment().registrationMode,
): RegistrationAvailability {
  return {
    mode,
    openRegistration: mode === "open",
    invitations: mode === "invitation",
  };
}

interface SelfRegistrationInput {
  email: string;
  password: string;
  displayName: string;
}

/**
 * Public open self-registration. It is available only when the configured mode
 * is `open` (Roadmap 8.3); in any other mode it behaves as if the endpoint does
 * not exist (404). Email verification is intentionally disabled in the MVP, so
 * the mode is `closed` by default and open registration can only be enabled
 * through an explicit REGISTRATION_MODE change – it can never be silently active.
 *
 * The Better Auth user, its credential account, and the collector profile are
 * created in one transaction (mirroring the admin-created and bootstrap paths)
 * so a partial failure leaves no half-created account. Passwords reuse the
 * shared Argon2id hashing path and are never stored or logged in plaintext.
 * Email uniqueness relies on the `"user".email` unique constraint, so a
 * duplicate address is handled safely as a neutral conflict.
 */
export async function registerOpenAccount(
  input: SelfRegistrationInput,
  pool: Pool = getPool(),
  mode: RegistrationMode = getEnvironment().registrationMode,
): Promise<{ userId: string }> {
  if (!evaluateRegistration(mode).openRegistration) {
    throw new RegistrationError("Open registration is not enabled.", 404);
  }
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 100) {
    throw new RegistrationError("A display name is required.");
  }
  if (
    input.password.length < minimumPasswordLength ||
    input.password.length > maximumPasswordLength
  ) {
    throw new RegistrationError(
      `Passwords must contain ${minimumPasswordLength} through ${maximumPasswordLength} characters.`,
    );
  }
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  try {
    const userId = await withTransaction(async (client) => {
      const user = await query<{ id: string }>(
        `INSERT INTO "user" (name, email, "emailVerified", "mustChangePassword", role, status)
         VALUES ($1, $2, true, false, 'user', 'active') RETURNING id`,
        [displayName, email],
        client,
      );
      const id = user.rows[0]!.id;
      await query(
        `INSERT INTO account ("accountId", "providerId", "userId", password, "createdAt", "updatedAt")
         VALUES ($1, 'credential', $2, $3, now(), now())`,
        [id, id, passwordHash],
        client,
      );
      await query(
        "INSERT INTO collector_profiles (user_id, display_name) VALUES ($1, $2)",
        [id, displayName],
        client,
      );
      return id;
    }, pool);
    writeLog("info", "identity.self_registered", { userId });
    return { userId };
  } catch (error) {
    if (error instanceof DatabaseError && error.code === "23505") {
      throw new RegistrationError("This email address is not available.", 409);
    }
    if (error instanceof DatabaseError) {
      throw new RegistrationError("The service is temporarily unavailable.", 503);
    }
    throw error;
  }
}
