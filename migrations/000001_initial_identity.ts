import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  pgm.createTable("user", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "text", notNull: true },
    email: { type: "text", notNull: true, unique: true },
    emailVerified: { type: "boolean", notNull: true, default: false },
    image: { type: "text" },
    createdAt: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updatedAt: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    mustChangePassword: { type: "boolean", notNull: true, default: false },
  });

  pgm.createTable("session", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    expiresAt: { type: "timestamptz", notNull: true },
    token: { type: "text", notNull: true, unique: true },
    createdAt: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updatedAt: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    ipAddress: { type: "text" },
    userAgent: { type: "text" },
    userId: {
      type: "uuid",
      notNull: true,
      references: '"user"(id)',
      onDelete: "CASCADE",
    },
  });
  pgm.createIndex("session", "userId");

  pgm.createTable("account", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    accountId: { type: "text", notNull: true },
    providerId: { type: "text", notNull: true },
    userId: {
      type: "uuid",
      notNull: true,
      references: '"user"(id)',
      onDelete: "CASCADE",
    },
    accessToken: { type: "text" },
    refreshToken: { type: "text" },
    idToken: { type: "text" },
    accessTokenExpiresAt: { type: "timestamptz" },
    refreshTokenExpiresAt: { type: "timestamptz" },
    scope: { type: "text" },
    password: { type: "text" },
    createdAt: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updatedAt: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("account", "account_provider_unique", {
    unique: ["providerId", "accountId"],
  });
  pgm.createIndex("account", "userId");

  pgm.createTable("verification", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    identifier: { type: "text", notNull: true },
    value: { type: "text", notNull: true },
    expiresAt: { type: "timestamptz", notNull: true },
    createdAt: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updatedAt: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("verification", "identifier");
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable("verification");
  pgm.dropTable("account");
  pgm.dropTable("session");
  pgm.dropTable("user");
}
