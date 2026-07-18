import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("Argon2id password hashing", () => {
  it("hashes and verifies without retaining plaintext", async () => {
    const password = "a correct horse battery staple";
    const encoded = await hashPassword(password);

    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(encoded).not.toContain(password);
    await expect(verifyPassword({ hash: encoded, password })).resolves.toBe(true);
    await expect(verifyPassword({ hash: encoded, password: "wrong password" })).resolves.toBe(false);
  });

  it("rejects malformed hashes safely", async () => {
    await expect(verifyPassword({ hash: "not-an-argon-hash", password: "irrelevant" })).resolves.toBe(false);
  });
});
