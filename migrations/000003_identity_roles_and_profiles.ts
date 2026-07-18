import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.addColumns("user", {
    role: { type: "text", notNull: true, default: "user" },
    status: { type: "text", notNull: true, default: "active" },
  });
  pgm.addConstraint("user", "user_role_check", { check: "role IN ('user', 'admin')" });
  pgm.addConstraint("user", "user_status_check", { check: "status IN ('active', 'suspended')" });
  pgm.addColumn("collector_profiles", {
    user_id: { type: "uuid", references: '"user"(id)', onDelete: "CASCADE" },
  });
  pgm.createIndex("collector_profiles", "user_id", { unique: true, where: "user_id IS NOT NULL" });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumn("collector_profiles", "user_id");
  pgm.dropConstraint("user", "user_status_check");
  pgm.dropConstraint("user", "user_role_check");
  pgm.dropColumns("user", ["status", "role"]);
}
