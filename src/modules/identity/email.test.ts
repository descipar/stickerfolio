import { describe, expect, it } from "vitest";

import { loginEmailSchema } from "./email";

describe("login email validation", () => {
  it("trims and lowercases an address before validating it", () => {
    expect(loginEmailSchema.parse("  Person@Example.Test \n")).toBe("person@example.test");
  });

  it("still rejects invalid addresses after normalization", () => {
    expect(loginEmailSchema.safeParse("  not-an-email  ").success).toBe(false);
  });
});
