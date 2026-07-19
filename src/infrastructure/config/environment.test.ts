import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  parseEnvironment,
  redactEnvironmentForLogging,
} from "./environment";

const validEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://stickerfolio:secret@database:5432/stickerfolio",
  APP_BASE_URL: "http://localhost:3500",
  BETTER_AUTH_SECRET: "a-secure-test-secret-with-32-characters",
  REGISTRATION_MODE: "closed",
};

describe("environment configuration", () => {
  it("parses the required bundled PostgreSQL configuration", () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment.database).toEqual({
      url: validEnvironment.DATABASE_URL,
      sslMode: "disable",
      poolMax: 10,
      idleTimeoutMs: 30_000,
      connectionTimeoutMs: 5_000,
    });
    expect(environment.appBaseUrl.href).toBe("http://localhost:3500/");
    expect(environment.registrationMode).toBe("closed");
    expect(environment.smtp).toBeNull();
  });

  it("supports verified external PostgreSQL TLS and SMTP", () => {
    const environment = parseEnvironment({
      ...validEnvironment,
      DATABASE_URL: "postgresql://user:password@db.example.com:5432/stickerfolio",
      DATABASE_SSL_MODE: "verify-full",
      DATABASE_SSL_CA: "example certificate",
      DATABASE_POOL_MAX: "18",
      DATABASE_IDLE_TIMEOUT_MS: "45000",
      DATABASE_CONNECTION_TIMEOUT_MS: "8000",
      REGISTRATION_MODE: "invitation",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "mailer-password",
      SMTP_FROM: "Stickerfolio <stickerfolio@example.com>",
    });

    expect(environment.database.sslMode).toBe("verify-full");
    expect(environment.database.certificateAuthority).toBe("example certificate");
    expect(environment.database.poolMax).toBe(18);
    expect(environment.database.idleTimeoutMs).toBe(45_000);
    expect(environment.database.connectionTimeoutMs).toBe(8_000);
    expect(environment.smtp).toMatchObject({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "mailer",
    });
  });

  it("accepts only a valid explicit trusted client IP header", () => {
    expect(
      parseEnvironment({ ...validEnvironment, AUTH_TRUSTED_IP_HEADER: " X-Real-IP " }).auth,
    ).toMatchObject({ trustedIpHeader: "x-real-ip" });
    expect(() =>
      parseEnvironment({ ...validEnvironment, AUTH_TRUSTED_IP_HEADER: "x-real-ip, x-forwarded-for" }),
    ).toThrow("valid HTTP header name");
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        AUTH_TRUSTED_IP_HEADER: "x-stickerfolio-untrusted-ip-sink",
      }),
    ).toThrow("reserved Stickerfolio header");
  });

  it("fails clearly when required values are missing", () => {
    expect(() => parseEnvironment({})).toThrow(EnvironmentValidationError);
    expect(() => parseEnvironment({})).toThrow("DATABASE_URL");
    expect(() => parseEnvironment({})).toThrow("APP_BASE_URL");
    expect(() => parseEnvironment({})).toThrow("BETTER_AUTH_SECRET");
  });

  it("never includes invalid secret values in validation errors", () => {
    const invalidSecret = "do-not-print-me";

    try {
      parseEnvironment({ ...validEnvironment, BETTER_AUTH_SECRET: invalidSecret });
      throw new Error("Expected configuration validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect(String(error)).not.toContain(invalidSecret);
    }
  });

  it("rejects incomplete TLS and SMTP configuration", () => {
    expect(() =>
      parseEnvironment({ ...validEnvironment, DATABASE_SSL_MODE: "verify-full" }),
    ).toThrow("DATABASE_SSL_CA");
    expect(() => parseEnvironment({ ...validEnvironment, SMTP_HOST: "smtp.example.com" })).toThrow(
      "SMTP_FROM",
    );
  });

  it("redacts secrets before configuration is logged", () => {
    expect(redactEnvironmentForLogging(validEnvironment)).toMatchObject({
      DATABASE_URL: "<redacted>",
      BETTER_AUTH_SECRET: "<redacted>",
      APP_BASE_URL: validEnvironment.APP_BASE_URL,
      REGISTRATION_MODE: "closed",
    });
  });
});
