import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import {
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  createAuth,
} from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);

function authRequest(
  auth: ReturnType<typeof createAuth>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return auth.handler(
    new Request(`${environment.appBaseUrl.origin}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("authentication abuse protection", () => {
  beforeAll(async () => {
    await query(`TRUNCATE "user" CASCADE`, [], pool);
    await bootstrapInitialAdmin(pool);
  });

  afterAll(async () => pool.end());

  it("does not let spoofed forwarding headers evade the login limit", async () => {
    const auth = createAuth(environment, pool);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await authRequest(
        auth,
        "/sign-in/email",
        { email: "unknown@example.test", password: "incorrect" },
        { "x-forwarded-for": `203.0.113.${attempt + 1}` },
      );
      statuses.push(response.status);
      if (attempt === 5) expect(response.headers.get("x-retry-after")).not.toBeNull();
    }

    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses[5]).toBe(429);
  });

  it("rate limits valid bootstrap credentials just like any other login", async () => {
    const auth = createAuth(
      { ...environment, auth: { ...environment.auth, trustedIpHeader: "x-real-ip" } },
      pool,
    );
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await authRequest(
        auth,
        "/sign-in/email",
        { email: bootstrapAdminEmail, password: bootstrapAdminPassword },
        { "x-real-ip": "192.0.2.34" },
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });

  it("protects the registration path even while self-registration is disabled", async () => {
    const auth = createAuth(
      { ...environment, auth: { ...environment.auth, trustedIpHeader: "x-real-ip" } },
      pool,
    );
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await authRequest(
        auth,
        "/sign-up/email",
        { name: "Automated signup", email: `signup-${attempt}@example.test`, password: "valid-password" },
        { "x-real-ip": "192.0.2.35" },
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses[5]).toBe(429);
  });
});
