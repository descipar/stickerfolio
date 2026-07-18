import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedImportMessages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

describe("module boundaries", () => {
  it("rejects a dependency that is outside the module graph", async () => {
    const messages = await restrictedImportMessages(
      'import "@/modules/collectors";',
      "src/modules/identity/use-case.ts",
    );

    expect(messages[0]).toContain("identity may not depend on the collectors module");
  });

  it("rejects the committed cross-module internal import fixture", async () => {
    const fixture = await readFile(
      fileURLToPath(new URL("./fixtures/module-boundaries/invalid-import.ts.txt", import.meta.url)),
      "utf8",
    );
    const messages = await restrictedImportMessages(fixture, "src/modules/identity/invalid.ts");

    expect(messages[0]).toContain("public index");
  });

  it("allows a dependency through an approved module public API", async () => {
    const messages = await restrictedImportMessages(
      'import "@/modules/catalog";',
      "src/modules/collections/use-case.ts",
    );

    expect(messages).toEqual([]);
  });

  it("keeps direct database access out of UI and HTTP code", async () => {
    const messages = await restrictedImportMessages(
      'import "@/infrastructure/database";',
      "src/app/api/example/route.ts",
    );

    expect(messages[0]).toContain("database directly");
  });
});
