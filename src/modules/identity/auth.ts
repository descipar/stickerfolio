import type { Pool } from "pg";
import { betterAuth } from "better-auth";

import { getEnvironment, type AppEnvironment } from "@/infrastructure/config";
import { getPool } from "@/infrastructure/database";
import { query } from "@/infrastructure/database";

import { hashPassword, verifyPassword } from "./password";

export function createAuth(environment: AppEnvironment, pool: Pool) {
  return betterAuth({
    appName: "Stickerfolio",
    baseURL: environment.appBaseUrl.origin,
    basePath: "/api/auth",
    secret: environment.auth.secret,
    database: pool,
    trustedOrigins: [environment.appBaseUrl.origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: true, defaultValue: "user", input: false },
        status: { type: "string", required: true, defaultValue: "active", input: false },
        mustChangePassword: {
          type: "boolean",
          fieldName: "mustChangePassword",
          required: true,
          defaultValue: false,
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await query<{ status: string }>(
              `SELECT status FROM "user" WHERE id = $1`,
              [session.userId],
              pool,
            );
            return user.rows[0]?.status === "active";
          },
        },
      },
    },
    advanced: {
      database: { generateId: false },
      useSecureCookies: environment.appBaseUrl.protocol === "https:",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: environment.appBaseUrl.protocol === "https:",
        path: "/",
      },
    },
  });
}

export type StickerfolioAuth = ReturnType<typeof createAuth>;

let authInstance: StickerfolioAuth | undefined;

export function getAuth(): StickerfolioAuth {
  authInstance ??= createAuth(getEnvironment(), getPool());
  return authInstance;
}
