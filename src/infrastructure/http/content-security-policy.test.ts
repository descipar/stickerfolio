import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, createCspNonce } from "./content-security-policy";

describe("nonce-based content security policy (#134)", () => {
  it("creates a fresh, unguessable nonce per request", () => {
    const nonces = new Set(Array.from({ length: 100 }, createCspNonce));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) expect(Buffer.from(nonce, "base64")).toHaveLength(16);
  });

  it("allows scripts only by nonce in production", () => {
    const policy = buildContentSecurityPolicy("abc123==");
    const scriptSrc = policy.split("; ").find((directive) => directive.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it("adds only what React Refresh needs in development", () => {
    const policy = buildContentSecurityPolicy("n", true);
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws:");
  });
});
