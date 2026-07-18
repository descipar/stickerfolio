import { hash, verify, type Options } from "@node-rs/argon2";

export const argon2idParameters = {
  algorithm: 2,
  version: 1,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, argon2idParameters);
}

export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(data.hash, data.password);
  } catch {
    return false;
  }
}
