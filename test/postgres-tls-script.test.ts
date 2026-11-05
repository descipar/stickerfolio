import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const helper = path.resolve(__dirname, "../scripts/postgres-tls.sh").replaceAll("\\", "/");
const shellAvailable = spawnSync("sh", ["-c", "exit 0"]).status === 0;

const certificate = "-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----";

const baseEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("DATABASE_") && !name.startsWith("PG")),
);

function configure(environment: Record<string, string>) {
  const script = `. "${helper}"; stickerfolio_configure_external_tls; ` +
    'echo "mode=$PGSSLMODE"; echo "root=${PGSSLROOTCERT:-}"; ' +
    'if [ -n "${PGSSLROOTCERT:-}" ]; then cat "$PGSSLROOTCERT"; ls -ld "$(dirname "$PGSSLROOTCERT")"; fi';
  const result = spawnSync("sh", ["-c", script], {
    encoding: "utf8",
    env: { ...baseEnvironment, NODE_ENV: "test", PGSSLMODE: "prefer", ...environment },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe.skipIf(!shellAvailable)("external backup TLS policy", () => {
  it("defaults to verify-full and writes the CA to a private temporary file", () => {
    const result = configure({
      DATABASE_URL: "postgresql://user@db.example.test/stickerfolio",
      DATABASE_SSL_CA: certificate.replaceAll("\n", "\n"),
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("mode=verify-full");
    expect(result.stdout).toContain("-----BEGIN CERTIFICATE-----\nMIIBtest\n");
    if (process.platform !== "win32") expect(result.stdout).toMatch(/\ndrwx------/);
  });

  it("removes the temporary CA when the shell exits", () => {
    const result = configure({
      DATABASE_URL: "postgresql://user@db.example.test/stickerfolio",
      DATABASE_SSL_CA: certificate,
    });
    const root = /root=(.+)/.exec(result.stdout)?.[1];
    expect(root).toBeTruthy();
    const check = spawnSync("sh", ["-c", `test -e "${root}"`]);
    expect(check.status).not.toBe(0);
  });

  it("fails clearly without a CA for the default mode", () => {
    const result = configure({ DATABASE_URL: "postgresql://user@db.example.test/stickerfolio" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("DATABASE_SSL_CA is required");
  });

  it("rejects TLS options embedded in DATABASE_URL", () => {
    const result = configure({
      DATABASE_URL: "postgresql://user@db.example.test/stickerfolio?sslmode=prefer",
      DATABASE_SSL_MODE: "require",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("remove ssl* parameters");
  });

  it("honours an explicit weaker mode with a warning", () => {
    const result = configure({
      DATABASE_URL: "postgresql://user@db.example.test/stickerfolio",
      DATABASE_SSL_MODE: "require",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("mode=require");
    expect(result.stderr).toContain("does not authenticate the server");
  });

  it("rejects an unknown mode", () => {
    const result = configure({
      DATABASE_URL: "postgresql://user@db.example.test/stickerfolio",
      DATABASE_SSL_MODE: "prefer",
    });
    expect(result.status).toBe(2);
  });
});
