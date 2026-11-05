import type { Pool } from "pg";
import { betterAuth } from "better-auth";

import { getEnvironment, type AppEnvironment } from "@/infrastructure/config";
import { getPool } from "@/infrastructure/database";
import { resolveClientAddressHeader, untrustedIpSinkHeader } from "@/infrastructure/http";
import { hashPassword, isActiveAccount, verifyPassword } from "@/modules/identity";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

/**
 * Better Auth is the cookie-session adapter of the delivery layer (#126). It
 * handles sign-in, sign-out, and session lookup; domain modules never import
 * it. Accounts, passwords, and their tables belong to the identity module.
 */

export function createAuth(environment: AppEnvironment, pool: Pool) {
  return betterAuth({
    appName: "Stickerfolio",
    baseURL: environment.appBaseUrl.origin,
    basePath: "/api/auth",
    secret: environment.auth.secret,
    database: pool,
    trustedOrigins: [environment.appBaseUrl.origin],
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: minimumPasswordLength,
      maxPasswordLength: maximumPasswordLength,
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
          before: async (session) => isActiveAccount(session.userId, pool),
        },
      },
    },
    advanced: {
      database: { generateId: false },
      ipAddress: {
        // A trusted proxy header or the socket address recorded by the
        // client-address preload (#124). Without either, Better Auth falls back
        // to one shared bucket per path, so the sink header is never trusted.
        ipAddressHeaders: [
          resolveClientAddressHeader(environment.auth.trustedIpHeader) ?? untrustedIpSinkHeader,
        ],
      },
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
