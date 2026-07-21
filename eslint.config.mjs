import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const modules = ["identity", "collectors", "catalog", "collections", "trading", "admin"];
const dependencies = {
  identity: [],
  collectors: ["identity"],
  catalog: [],
  collections: ["collectors", "catalog"],
  trading: ["collectors", "catalog", "collections"],
  admin: ["identity", "collectors", "catalog"],
};

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
          paths: disallowedRoots,
          patterns: [
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
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "e2e/**", "playwright.config.ts"]),
]);
