import { performance } from "node:perf_hooks";

import { argon2idParameters, hashPassword, verifyPassword } from "@/modules/identity";

async function measured(operation: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

async function main(): Promise<void> {
  const password = "benchmark-only-password";
  const hashMs = await measured(() => hashPassword(password));
  const encoded = await hashPassword(password);
  const verifyMs = await measured(() => verifyPassword({ hash: encoded, password }));
  const concurrentStarted = performance.now();
  await Promise.all(Array.from({ length: 4 }, () => verifyPassword({ hash: encoded, password })));
  const fourConcurrentMs = performance.now() - concurrentStarted;

  console.info(
    JSON.stringify({
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      parameters: argon2idParameters,
      milliseconds: { hash: hashMs, verify: verifyMs, fourConcurrentVerifications: fourConcurrentMs },
    }),
  );
}

void main();
