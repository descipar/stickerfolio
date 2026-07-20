import { describe, expect, it } from "vitest";

import { generateInvitationToken, hashInvitationToken } from "./invitations";

describe("invitation tokens", () => {
  it("hashes deterministically and never equals the plaintext token", () => {
    const token = generateInvitationToken();
    expect(hashInvitationToken(token)).not.toBe(token);
    expect(hashInvitationToken(token)).toBe(hashInvitationToken(token));
    expect(hashInvitationToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces unique, high-entropy tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInvitationToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token.length).toBeGreaterThan(20);
  });
});
