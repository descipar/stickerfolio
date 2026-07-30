# Security

## First-start exposure warning

> [!CAUTION]
> A completely empty database creates the restricted bootstrap account `admin@stickerfolio.local` with the known temporary password `admin123!`. Do not expose a new installation to the public internet until the administrator has signed in and changed this password.

The bootstrap account has no collector profile, personal collection, or holdings. Protected administration functions remain blocked until its temporary password is changed. The bootstrap process never resets an existing credential and never runs once normal users exist.

## Secrets and transport

Use a unique random `BETTER_AUTH_SECRET` of at least 32 characters and unique database credentials. Keep `.env` readable only by the deployment operator and do not commit it.

Terminate public traffic with HTTPS. Once the complete public hostname and redirect path have been verified, configure HSTS at the TLS terminator. Session cookies are HTTP-only and `SameSite=Lax`; HTTPS deployments receive Secure cookies.

For an external production PostgreSQL database, set
`DATABASE_SSL_MODE=verify-full` and provide the trusted
`DATABASE_SSL_CA`. The `require` mode encrypts database traffic but does not
authenticate the server and therefore remains vulnerable to an active
man-in-the-middle endpoint. Use `disable` only across an explicitly trusted,
isolated private link. The bundled Compose deployment uses `disable` solely
inside its private Docker network. See [Deployment](DEPLOYMENT.md#external-postgresql)
for the complete mode comparison.

## Trusted proxy addresses

Leave `AUTH_TRUSTED_IP_HEADER` empty for direct deployments. Set it only when the application origin is reachable exclusively through a trusted reverse proxy that removes every client-supplied value and writes the real client address into one single-value header, such as `X-Real-IP`.

Stickerfolio deliberately ignores `X-Forwarded-For` and all other forwarding headers by default. Without a trusted header, callers share conservative per-endpoint rate-limit buckets; this is safe against spoofing but can cause one busy client to throttle others temporarily.

## Rate limits and request validation

- login attempts: five requests per minute and client address;
- open registration: ten requests per minute and client address;
- invitation redemption: ten requests per minute and client address.
- public share pages: 120 requests per minute and client address.

Counters are process-local and support the documented single-application-instance deployment. Horizontal application scaling requires a shared rate-limit store first.

State-changing API requests validate the browser `Origin` against `APP_BASE_URL` and use Fetch Metadata checks. JSON request bodies are limited to 32 KiB and album-template uploads to 2 MiB.

Responses include a restrictive content security policy, clickjacking protection, MIME-sniffing protection, a limited referrer policy, and disabled camera, location, and microphone access.

## Privacy and authorization

Collector holdings are owner-scoped. Administrators manage accounts and catalogs without blanket access to personal collection or trade data. Trade matching is explicit opt-in and reveals only a display name and stickers relevant to a possible exchange.

Collection sharing is also explicit and disabled by default. Share secrets use
256 bits of randomness and are stored only as SHA-256 hashes. The complete link
is returned once at creation and is never written to application logs, account
exports, or audit events. Public views reveal only the selected missing and/or
duplicate entries for one collection. Unknown, expired, and revoked tokens all
resolve to the same not-found response. Share responses are non-cacheable,
carry `noindex` directives, and use a `no-referrer` policy so the capability
token is not leaked through outgoing navigation.

The complete account-data export is also owner-scoped from the authenticated
session. It includes only non-sensitive account fields and the owner's profile,
preferences, collections, quantities, and token-free share metadata;
authentication secrets and other collectors' data are excluded. Responses are
marked private and non-cacheable.

Security-sensitive account and album-publication operations emit data-minimized structured audit events. Logs redact credentials, authentication tokens, and complete database URLs.

Password hashing parameters and constrained-host measurements are documented in [Password hashing](PASSWORD_HASHING.md). Account deletion, suspension, session revocation, and audit behavior are documented in [Account lifecycle](ACCOUNT_LIFECYCLE.md).
