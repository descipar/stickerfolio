import { z } from "zod";

/**
 * Canonical email normalization for the login identity. This is the single
 * source of truth used when storing or comparing an email at account creation
 * and whenever the address is changed, so an edited email matches how logins
 * are compared. Do not introduce a second normalization elsewhere.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalizes user input before validating the canonical login address. */
export const loginEmailSchema = z.preprocess(
  (value) => typeof value === "string" ? normalizeEmail(value) : value,
  z.email().max(254),
);
