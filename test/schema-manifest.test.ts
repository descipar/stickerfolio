import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { expectedMigrations } from "@/infrastructure/database";

describe("schema manifest", () => {
  it("lists exactly the repository migrations in order", () => {
    const files = readdirSync(path.resolve(__dirname, "../migrations"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => file.replace(/\.ts$/, ""))
      .sort();
    expect([...expectedMigrations]).toEqual(files);
  });
});
