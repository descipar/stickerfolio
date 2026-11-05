#!/bin/sh
# Shared libpq TLS policy for external backup and restore (#130).
#
# Sourced by postgres-backup.sh and postgres-restore.sh. Mirrors the
# application's DATABASE_SSL_MODE / DATABASE_SSL_CA policy for pg_dump and
# pg_restore, defaulting to verify-full instead of libpq's "prefer".

stickerfolio_tls_tmpdir=

stickerfolio_tls_cleanup() {
  if [ -n "$stickerfolio_tls_tmpdir" ]; then
    rm -rf "$stickerfolio_tls_tmpdir"
  fi
}

stickerfolio_tls_fail() {
  echo "TLS configuration error: $1" >&2
  exit 2
}

# Configures PGSSLMODE and PGSSLROOTCERT for the current process.
stickerfolio_configure_external_tls() {
  case "$DATABASE_URL" in
    *sslmode=* | *sslrootcert=* | *sslcert=* | *sslkey=*)
      stickerfolio_tls_fail "remove ssl* parameters from DATABASE_URL and use DATABASE_SSL_MODE and DATABASE_SSL_CA instead."
      ;;
  esac

  # Only the Stickerfolio variables decide the policy.
  unset PGSSLMODE PGSSLROOTCERT PGSSLCERT PGSSLKEY PGSSLCRL

  ssl_mode=${DATABASE_SSL_MODE:-verify-full}
  case "$ssl_mode" in
    disable)
      echo "Warning: DATABASE_SSL_MODE=disable sends the backup unencrypted." >&2
      PGSSLMODE=disable
      ;;
    require)
      echo "Warning: DATABASE_SSL_MODE=require encrypts but does not authenticate the server." >&2
      PGSSLMODE=require
      ;;
    verify-ca | verify-full)
      [ -n "${DATABASE_SSL_CA:-}" ] ||
        stickerfolio_tls_fail "DATABASE_SSL_CA is required when DATABASE_SSL_MODE is $ssl_mode (the default for --external)."
      stickerfolio_tls_tmpdir=$(umask 077 && mktemp -d) ||
        stickerfolio_tls_fail "could not create a private temporary directory."
      trap stickerfolio_tls_cleanup EXIT
      trap 'stickerfolio_tls_cleanup; exit 130' INT TERM
      # Accept real newlines and the escaped "\n" form used in env files.
      (umask 077 && printf '%b\n' "$DATABASE_SSL_CA" > "$stickerfolio_tls_tmpdir/root.crt")
      grep -q -- '-----BEGIN CERTIFICATE-----' "$stickerfolio_tls_tmpdir/root.crt" ||
        stickerfolio_tls_fail "DATABASE_SSL_CA does not contain a PEM certificate."
      PGSSLMODE=$ssl_mode
      PGSSLROOTCERT=$stickerfolio_tls_tmpdir/root.crt
      export PGSSLROOTCERT
      ;;
    *)
      stickerfolio_tls_fail "DATABASE_SSL_MODE must be disable, require, verify-ca, or verify-full."
      ;;
  esac
  export PGSSLMODE
}
