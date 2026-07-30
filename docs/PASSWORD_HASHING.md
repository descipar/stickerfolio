# Password hashing

Stickerfolio supplies Better Auth with explicit Argon2id hash and verification functions. Password hashes use Argon2 version 1.3 with 19 MiB memory, two iterations, one lane, a random salt, and a 32-byte output. The parameters are encoded in every stored hash so future parameter upgrades can continue to verify existing passwords.

The 19 MiB / two-iteration profile is a memory-conscious baseline for Raspberry Pi 4 deployments and concurrent use. It avoids multiplying a 64 MiB allocation by every simultaneous login while retaining a memory-hard Argon2id workload. The application rejects malformed hashes and never falls back to plaintext or a weaker algorithm.

Run the repeatable benchmark on the actual target host after building or updating the deployment:

```bash
pnpm benchmark:argon2
```

Or against the exact Compose image:

```bash
docker compose run --rm migrate node node_modules/tsx/dist/cli.mjs scripts/benchmark-argon2.ts
```

The command reports platform, CPU architecture, Node version, parameters, one hash, one verification, and four concurrent verifications as JSON. Record target-hardware results during the release checklist; do not lower the parameters merely to satisfy a synthetic timing threshold.
