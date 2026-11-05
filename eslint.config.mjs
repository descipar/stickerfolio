import { readFileSync } from "node:fs";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// Single source of the module graph and table ownership (#125); also read by
// test/module-data-ownership.test.ts and documented in docs/ARCHITECTURE.md.
const moduleGraph = JSON.parse(readFileSync(new URL("./src/modules/module-graph.json", import.meta.url), "utf8"));
const dependencies = moduleGraph.dependencies;
const modules = Object.keys(dependencies);

// Modules receive a Principal; they never see HTTP, cookies, or the session library (#126).
const deliveryOnlyImports = [
  { name: "better-auth", message: "Only the delivery layer (src/auth) may use Better Auth." },
  { name: "@/auth", message: "Modules receive a Principal instead of resolving sessions." },
  { name: "next/headers", message: "Modules must not read HTTP request state." },
  { name: "next/server", message: "Modules must not depend on the HTTP framework." },
];

const moduleBoundaryConfig = (moduleName) => {
  const allowed = new Set(dependencies[moduleName]);
  const disallowedRoots = modules
    .filter((candidate) => candidate !== moduleName && !allowed.has(candidate))
    .map((candidate) => ({
      name: `@/modules/${candidate}`,
      message: `${moduleName} may not depend on the ${candidate} module.`,
    }));
  const privatePatterns = modules
    .filter((candidate) => candidate !== moduleName)
    .flatMap((candidate) => [
      `@/modules/${candidate}/*`,
      `../${candidate}/*`,
      `../../${candidate}/*`,
      `../../../${candidate}/*`,
    ]);
  const disallowedRelativeRoots = modules
    .filter((candidate) => candidate !== moduleName && !allowed.has(candidate))
    .flatMap((candidate) => [`../${candidate}`, `../../${candidate}`, `../../../${candidate}`]);

  return {
    files: [`src/modules/${moduleName}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...disallowedRoots, ...deliveryOnlyImports],
          patterns: [
            {
              group: ["better-auth/*", "@/auth/*"],
              message: "Modules receive a Principal instead of resolving sessions.",
            },
            {
              group: disallowedRelativeRoots,
              message: `${moduleName} may not depend on this module.`,
            },
            {
              group: privatePatterns,
              message: "Import another module through its public index instead of its internals.",
            },
          ],
        },
      ],
    },
  };
};

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  ...modules.map(moduleBoundaryConfig),
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/infrastructure/database",
              message: "UI and HTTP code must use module use cases instead of the database directly.",
            },
          ],
          patterns: [
            {
              group: ["@/modules/*/*"],
              message: "Import modules through their public index instead of their internals.",
            },
            {
              group: ["@/infrastructure/database/*"],
              message: "UI and HTTP code must use module use cases instead of the database directly.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "e2e/**",
    "playwright.config.ts",
    "load-test/k6/**",
    "load-test/data/**",
  ]),
]);
