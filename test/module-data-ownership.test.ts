import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import moduleGraph from "../src/modules/module-graph.json";

/**
 * Data ownership at the SQL level (#125).
 *
 * - Every table belongs to exactly one module (`tables`).
 * - Only the owner writes it: INSERT, UPDATE, DELETE, and FOR UPDATE locks.
 * - Another module may read it in its own SQL only when it depends on the
 *   owner and lists the table under `reads`. These read joins exist for
 *   performance (trade matching runs in PostgreSQL, #117); everything else
 *   goes through the owner's public API.
 */
type ModuleName = keyof typeof moduleGraph.dependencies;

const modulesRoot = path.resolve(__dirname, "../src/modules");
const modules = Object.keys(moduleGraph.dependencies) as ModuleName[];
const owners = new Map<string, ModuleName>();
for (const moduleName of modules) {
  for (const table of moduleGraph.tables[moduleName]) owners.set(table, moduleName);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}

/** SQL found in template and string literals that contain a SQL keyword. */
function sqlStatements(source: string): string[] {
  const literals = source.match(/`[^`]*`|"(?:[^"\\\n]|\\.)*"/g) ?? [];
  return literals.filter((literal) => /\b(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(literal));
}

const identifier = String.raw`"?([a-z_]+)"?`;

export function tableAccess(sql: string): { writes: Set<string>; reads: Set<string> } {
  const writes = new Set<string>();
  const reads = new Set<string>();
  for (const match of sql.matchAll(new RegExp(String.raw`\b(?:INSERT\s+INTO|(?<!FOR\s+)UPDATE|DELETE\s+FROM)\s+${identifier}`, "gi"))) {
    writes.add(match[1]!.toLowerCase());
  }
  for (const match of sql.matchAll(new RegExp(String.raw`\b(DELETE\s+)?(?:FROM|JOIN)\s+${identifier}`, "gi"))) {
    if (!match[1]) reads.add(match[2]!.toLowerCase());
  }
  // A row lock is a write intent: "FOR UPDATE OF t" or a plain FOR UPDATE on
  // the statement's tables.
  if (/\bFOR\s+UPDATE\b/i.test(sql)) {
    const locked = /\bFOR\s+UPDATE\s+OF\s+([^;`]+)/i.exec(sql);
    const targets = locked ? locked[1]!.split(",").map((value) => value.trim().replace(/"/g, "")) : [...reads];
    for (const target of targets) writes.add(target.toLowerCase());
  }
  return { writes, reads };
}

interface Violation {
  module: ModuleName;
  file: string;
  table: string;
  access: "write" | "read";
  owner: ModuleName;
}

function findViolations(): Violation[] {
  const violations: Violation[] = [];
  for (const moduleName of modules) {
    const allowedReads = new Set(moduleGraph.reads[moduleName]);
    for (const file of sourceFiles(path.join(modulesRoot, moduleName))) {
      for (const sql of sqlStatements(readFileSync(file, "utf8"))) {
        const { writes, reads } = tableAccess(sql);
        for (const [tables, access] of [[writes, "write"], [reads, "read"]] as const) {
          for (const table of tables) {
            const owner = owners.get(table);
            if (!owner || owner === moduleName) continue;
            if (access === "read" && allowedReads.has(table)) continue;
            violations.push({ module: moduleName, file: path.relative(modulesRoot, file), table, access, owner });
          }
        }
      }
    }
  }
  return violations;
}

describe("module data ownership (#125)", () => {
  it("assigns every migrated table to exactly one module", () => {
    const migrations = readdirSync(path.resolve(__dirname, "../migrations"))
      .map((file) => readFileSync(path.resolve(__dirname, "../migrations", file), "utf8"))
      .join("\n");
    const created = new Set(
      [...migrations.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+"?([a-z_]+)"?/gi)]
        .map((match) => match[1]!.toLowerCase())
        .concat([...migrations.matchAll(/createTable\("([a-z_]+)"/g)].map((match) => match[1]!)),
    );
    expect([...created].filter((table) => !owners.has(table))).toEqual([]);
    const all = modules.flatMap((moduleName) => moduleGraph.tables[moduleName]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("only lets a module read foreign tables of modules it depends on", () => {
    for (const moduleName of modules) {
      const dependencies = new Set<string>(moduleGraph.dependencies[moduleName]);
      for (const table of moduleGraph.reads[moduleName]) {
        expect(owners.has(table), `${moduleName} reads unknown table ${table}`).toBe(true);
        expect(dependencies.has(owners.get(table)!), `${moduleName} reads ${table} without depending on its owner`).toBe(true);
      }
    }
  });

  it("finds no write to, and no undeclared read of, another module's tables", () => {
    expect(findViolations()).toEqual([]);
  });

  it("detects foreign writes and undeclared reads", () => {
    expect(tableAccess(`INSERT INTO collector_profiles (user_id) VALUES ($1)`).writes).toContain("collector_profiles");
    expect(tableAccess(`UPDATE "user" SET email = $1`).writes).toContain("user");
    expect(tableAccess(`DELETE FROM session WHERE id = $1`)).toMatchObject({
      writes: new Set(["session"]),
      reads: new Set(),
    });
    expect(tableAccess(`SELECT 1 FROM collections c JOIN holdings h ON true`).reads).toEqual(
      new Set(["collections", "holdings"]),
    );
    expect(tableAccess(`SELECT 1 FROM account JOIN "user" ON true FOR UPDATE OF account, "user"`).writes).toEqual(
      new Set(["account", "user"]),
    );
  });
});
