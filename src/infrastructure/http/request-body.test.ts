import { describe, expect, it } from "vitest";

import { cloneWithLimitedBody, readLimitedJson } from "./request-body";

describe("limited request bodies", () => {
  it("parses JSON below the configured limit", async () => {
    const result = await readLimitedJson(
      new Request("http://localhost/api/example", { method: "POST", body: '{"ok":true}' }),
      32,
    );
    expect(result).toEqual({ status: "ok", value: { ok: true } });
  });

  it("rejects a declared oversized request without reading it", async () => {
    const result = await readLimitedJson(
      new Request("http://localhost/api/example", {
        method: "POST",
        headers: { "content-length": "33" },
        body: "{}",
      }),
      32,
    );
    expect(result).toEqual({ status: "too-large" });
  });

  it("rejects a streamed oversized request without content-length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345678"));
        controller.enqueue(new TextEncoder().encode("9"));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/example", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readLimitedJson(request, 8)).resolves.toEqual({ status: "too-large" });
  });

  it("clones an allowed auth request with its body intact", async () => {
    const result = await cloneWithLimitedBody(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        body: '{"email":"person@example.test"}',
      }),
      128,
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      await expect(result.value.json()).resolves.toEqual({ email: "person@example.test" });
    }
  });
});
