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
      'import "@/modules/identity";',
      "src/modules/collectors/use-case.ts",
    );

    expect(messages[0]).toContain("collectors may not depend on the identity module");
  });

  it.each([
    ['import { betterAuth } from "better-auth";', "Better Auth"],
    ['import { toNextJsHandler } from "better-auth/next-js";', "Principal"],
    ['import { resolveSessionPrincipal } from "@/auth";', "Principal"],
    ['import { headers } from "next/headers";', "HTTP request state"],
  ])("keeps session and HTTP handling out of modules (#126): %s", async (code, expected) => {
    const messages = await restrictedImportMessages(code, "src/modules/trading/use-case.ts");

    expect(messages[0]).toContain(expected);
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

  it("lets no module use case accept HTTP headers (#126)", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const files = (function walk(directory: string): string[] {
      return readdirSync(directory).flatMap((entry) => {
        const full = path.join(directory, entry);
        return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
      });
    })(path.resolve(process.cwd(), "src/modules"));
    const offenders: string[] = [];
    for (const file of files) {
      if (/\bHeaders\b/.test(await readFile(file, "utf8"))) offenders.push(path.relative(process.cwd(), file));
    }

    expect(offenders).toEqual([]);
  });

  it("keeps direct database access out of UI and HTTP code", async () => {
    const messages = await restrictedImportMessages(
      'import "@/infrastructure/database";',
      "src/app/api/example/route.ts",
    );

    expect(messages[0]).toContain("database directly");
  });
});
