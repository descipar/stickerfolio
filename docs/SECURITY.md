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

## Client addresses for rate limits

Rate limits need an address per client that the client cannot choose.

- **Direct deployments** (the default): leave `AUTH_TRUSTED_IP_HEADER` empty.
  The server is started with `node --import client-address-preload.mjs` (the
  Docker image and `pnpm start` do this). The preload writes each connection's
  socket address into an internal header and overwrites any value a client sent.
- **Behind a reverse proxy**: the socket address is the proxy's, so all clients
  would share it. Set `AUTH_TRUSTED_IP_HEADER` only when the application origin
  is reachable exclusively through a trusted reverse proxy that removes every
  client-supplied value and writes the real client address into one
  single-value header, such as `X-Real-IP`.

Stickerfolio ignores `X-Forwarded-For` and all other forwarding headers unless
one is configured as trusted. If neither a trusted header nor the preload is
available, all clients share one bucket per endpoint, and a single client can
throttle sign-ins for everyone. The application logs
`security.rate_limit_shared_client_key` at startup in that case.

Note for Docker: connections from the Docker host itself (for example a browser
on the same machine, or Docker Desktop port forwarding) can all appear with the
Docker gateway address. Clients on the network keep their own address.

## Rate limits and request validation

- login attempts: five requests per minute and client address, and ten
  attempts per ten minutes and normalized email address;
- open registration: ten requests per minute and client address;
- invitation redemption: ten requests per minute and client address;
- comparison-code preparation and resolution: 30 requests per minute and
  signed-in session (client address for requests without a session);
- public share pages: 120 requests per minute and client address.

The per-email login limit stops distributed guessing against one account. As a
trade-off, someone who knows an address can delay that account's sign-in for up
to ten minutes, but no longer every account at once.

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
token is not leaked through outgoing navigation. Link creation additionally
requires an explicit `PUBLIC_SHARE_BASE_URL`; localhost and loopback origins are
rejected.

Direct comparison uses a separate, authenticated capability. Each grant has an
independent 256-bit QR token and a 50-bit manual code, stores only SHA-256
hashes, expires after 15 minutes, and can be revoked immediately. Manual-code
and result endpoints are rate-limited. Possession of a valid credential is not
enough by itself: the recipient must have an active signed-in collector profile
and an owned collection for the same logical album. Responses contain only the
partner display name and currently relevant exchange entries. They never expose
login identifiers, complete holdings, foreign collection IDs, or unrelated
stickers. Direct comparison neither reads nor changes the general trading
visibility preference. Tokenized comparison pages are non-cacheable, carry
`noindex` directives, and use a `no-referrer` policy.

The complete account-data export is also owner-scoped from the authenticated
session. It includes only non-sensitive account fields and the owner's profile,
preferences, collections, quantities, and token-free share/comparison metadata;
authentication secrets and other collectors' data are excluded. Responses are
marked private and non-cacheable.

Security-sensitive account and album-publication operations emit data-minimized structured audit events. Logs redact credentials, authentication tokens, and complete database URLs.

Password hashing parameters and constrained-host measurements are documented in [Password hashing](PASSWORD_HASHING.md). Account deletion, suspension, session revocation, and audit behavior are documented in [Account lifecycle](ACCOUNT_LIFECYCLE.md).
