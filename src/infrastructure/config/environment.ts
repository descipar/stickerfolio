import { z } from "zod";

export const registrationModes = ["closed", "invitation", "open"] as const;
export const databaseSslModes = ["disable", "require", "verify-ca", "verify-full"] as const;

const requiredText = (name: string) =>
  z.string({ error: `${name} is required` }).trim().min(1, `${name} is required`);

const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const optionalPublicShareBaseUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .url({ error: "PUBLIC_SHARE_BASE_URL must be a valid URL" })
    .superRefine((value, context) => {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) {
        context.addIssue({ code: "custom", message: "must use http or https" });
      }
      if (
        url.username
        || url.password
        || url.pathname !== "/"
        || url.search
        || url.hash
      ) {
        context.addIssue({
          code: "custom",
          message: "must be an origin without credentials, path, query, or fragment",
        });
      }
      const hostname = url.hostname.toLowerCase();
      if (
        hostname === "localhost"
        || hostname === "::1"
        || hostname === "[::1]"
        || hostname === "0.0.0.0"
        || /^127(?:\.\d{1,3}){3}$/.test(hostname)
      ) {
        context.addIssue({
          code: "custom",
          message: "must not use localhost or a loopback address",
        });
      }
    })
    .optional(),
);

const optionalHeaderName = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, "AUTH_TRUSTED_IP_HEADER must be a valid HTTP header name")
    .optional(),
);

const optionalBoolean = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.enum(["true", "false"]).default("false"),
);

const optionalPort = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().min(1).max(65_535).default(587),
);

const positiveInteger = (defaultValue: number, maximum: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().min(1).max(maximum).default(defaultValue),
  );

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: requiredText("DATABASE_URL").superRefine((value, context) => {
      try {
        const url = new URL(value);
        if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
          context.addIssue({ code: "custom", message: "must use the postgresql protocol" });
        }
        if (!url.hostname || url.pathname.length <= 1) {
          context.addIssue({ code: "custom", message: "must include a host and database name" });
        }
      } catch {
        context.addIssue({ code: "custom", message: "must be a valid PostgreSQL URL" });
      }
    }),
    APP_BASE_URL: z
      .url({ error: "APP_BASE_URL must be a valid URL" })
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
        message: "APP_BASE_URL must use http or https",
      }),
    PUBLIC_SHARE_BASE_URL: optionalPublicShareBaseUrl,
    BETTER_AUTH_SECRET: requiredText("BETTER_AUTH_SECRET").min(
      32,
      "BETTER_AUTH_SECRET must contain at least 32 characters",
    ),
    AUTH_TRUSTED_IP_HEADER: optionalHeaderName,
    REGISTRATION_MODE: z.enum(registrationModes).default("closed"),
    DATABASE_SSL_MODE: z.enum(databaseSslModes).default("disable"),
    DATABASE_SSL_CA: optionalText,
    DATABASE_POOL_MAX: positiveInteger(10, 50),
    DATABASE_IDLE_TIMEOUT_MS: positiveInteger(30_000, 300_000),
    DATABASE_CONNECTION_TIMEOUT_MS: positiveInteger(5_000, 60_000),
    SMTP_HOST: optionalText,
    SMTP_PORT: optionalPort,
    SMTP_SECURE: optionalBoolean,
    SMTP_USER: optionalText,
    SMTP_PASSWORD: optionalText,
    SMTP_FROM: optionalText,
  })
  .superRefine((value, context) => {
    if (value.AUTH_TRUSTED_IP_HEADER === "x-stickerfolio-untrusted-ip-sink") {
      context.addIssue({
        code: "custom",
        path: ["AUTH_TRUSTED_IP_HEADER"],
        message: "AUTH_TRUSTED_IP_HEADER uses a reserved Stickerfolio header",
      });
    }
    if (["verify-ca", "verify-full"].includes(value.DATABASE_SSL_MODE) && !value.DATABASE_SSL_CA) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_SSL_CA"],
        message: `DATABASE_SSL_CA is required when DATABASE_SSL_MODE is ${value.DATABASE_SSL_MODE}`,
      });
    }

    const smtpConfigured = Boolean(
      value.SMTP_HOST || value.SMTP_USER || value.SMTP_PASSWORD || value.SMTP_FROM,
    );
    if (smtpConfigured && !value.SMTP_HOST) {
      context.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "SMTP_HOST is required" });
    }
    if (smtpConfigured && !value.SMTP_FROM) {
      context.addIssue({ code: "custom", path: ["SMTP_FROM"], message: "SMTP_FROM is required" });
    }
    if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) {
      context.addIssue({
        code: "custom",
        path: [value.SMTP_USER ? "SMTP_PASSWORD" : "SMTP_USER"],
        message: "SMTP_USER and SMTP_PASSWORD must be configured together",
      });
    }
  });

export type RegistrationMode = (typeof registrationModes)[number];
export type DatabaseSslMode = (typeof databaseSslModes)[number];

export interface AppEnvironment {
  nodeEnv: "development" | "test" | "production";
  appBaseUrl: URL;
  publicShareBaseUrl: URL | null;
  registrationMode: RegistrationMode;
  database: {
    url: string;
    sslMode: DatabaseSslMode;
    certificateAuthority?: string;
    poolMax: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
  };
  auth: {
    secret: string;
    trustedIpHeader?: string;
  };
  smtp: null | {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
  };
}

export class EnvironmentValidationError extends Error {
  constructor(issues: z.core.$ZodIssue[]) {
    const details = issues
      .map((issue) => `- ${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("\n");
    super(`Invalid Stickerfolio environment configuration:\n${details}`);
    this.name = "EnvironmentValidationError";
  }
}

export function parseEnvironment(source: Record<string, string | undefined>): AppEnvironment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) throw new EnvironmentValidationError(result.error.issues);

  const value = result.data;
  const smtpConfigured = Boolean(value.SMTP_HOST && value.SMTP_FROM);

  return {
    nodeEnv: value.NODE_ENV,
    appBaseUrl: new URL(value.APP_BASE_URL),
    publicShareBaseUrl: value.PUBLIC_SHARE_BASE_URL
      ? new URL(value.PUBLIC_SHARE_BASE_URL)
      : null,
    registrationMode: value.REGISTRATION_MODE,
    database: {
      url: value.DATABASE_URL,
      sslMode: value.DATABASE_SSL_MODE,
      poolMax: value.DATABASE_POOL_MAX,
      idleTimeoutMs: value.DATABASE_IDLE_TIMEOUT_MS,
      connectionTimeoutMs: value.DATABASE_CONNECTION_TIMEOUT_MS,
      ...(value.DATABASE_SSL_CA ? { certificateAuthority: value.DATABASE_SSL_CA } : {}),
    },
    auth: {
      secret: value.BETTER_AUTH_SECRET,
      ...(value.AUTH_TRUSTED_IP_HEADER
        ? { trustedIpHeader: value.AUTH_TRUSTED_IP_HEADER }
        : {}),
    },
    smtp: smtpConfigured
      ? {
          host: value.SMTP_HOST!,
          port: value.SMTP_PORT,
          secure: value.SMTP_SECURE === "true",
          ...(value.SMTP_USER ? { user: value.SMTP_USER } : {}),
          ...(value.SMTP_PASSWORD ? { password: value.SMTP_PASSWORD } : {}),
          from: value.SMTP_FROM!,
        }
      : null,
  };
}

const sensitiveKeys = new Set([
  "DATABASE_URL",
  "DATABASE_SSL_CA",
  "BETTER_AUTH_SECRET",
  "SMTP_USER",
  "SMTP_PASSWORD",
]);

export function redactEnvironmentForLogging(
  source: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => [key, sensitiveKeys.has(key) ? "<redacted>" : value]),
  );
}

let cachedEnvironment: AppEnvironment | undefined;

export function getEnvironment(): AppEnvironment {
  cachedEnvironment ??= parseEnvironment(process.env);
  return cachedEnvironment;
}
