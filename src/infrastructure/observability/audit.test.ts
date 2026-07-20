import { afterEach, describe, expect, it, vi } from "vitest";

import { writeAuditEvent } from "./audit";

describe("security audit events", () => {
  afterEach(() => vi.restoreAllMocks());

  it("captures actor, action, target, and time in a structured event", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    writeAuditEvent(
      "account.role_changed",
      { type: "user", userId: "actor-id" },
      { type: "user", id: "target-id" },
      { role: "admin" },
    );

    const event = JSON.parse(String(output.mock.calls[0]?.[0]));
    expect(event).toMatchObject({
      event: "security.audit",
      audit: {
        action: "account.role_changed",
        actorType: "user",
        actorUserId: "actor-id",
        targetType: "user",
        targetId: "target-id",
        details: { role: "admin" },
      },
    });
    expect(new Date(event.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("redacts passwords, email addresses, tokens, and holdings recursively", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    writeAuditEvent(
      "account.password_reset",
      { type: "user", userId: "actor-id" },
      { type: "user", id: "target-id" },
      {
        password: "never-log-password",
        email: "never-log@example.test",
        token: "never-log-token",
        holdings: JSON.stringify([{ stickerId: "private-sticker", quantity: 9 }]),
      } as never,
    );

    const serialized = String(output.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("never-log-password");
    expect(serialized).not.toContain("never-log@example.test");
    expect(serialized).not.toContain("never-log-token");
    expect(serialized).not.toContain("private-sticker");
  });
});
