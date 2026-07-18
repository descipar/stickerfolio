import { afterEach, describe, expect, it, vi } from "vitest";

import { writeLog } from "./logger";

describe("structured logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one machine-readable event", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    writeLog("info", "application.started", { port: 3500 });

    expect(output).toHaveBeenCalledOnce();
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      level: "info",
      event: "application.started",
      port: 3500,
    });
  });

  it("redacts credentials, tokens, and complete database URLs recursively", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    writeLog("error", "database.failed", {
      password: "never-print-this",
      nested: { accessToken: "also-secret" },
      error: new Error("Could not connect to postgresql://user:password@database:5432/stickerfolio"),
    });

    const serialized = String(output.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("never-print-this");
    expect(serialized).not.toContain("also-secret");
    expect(serialized).not.toContain("user:password");
    expect(serialized).toContain("postgresql://<redacted>");
  });
});
