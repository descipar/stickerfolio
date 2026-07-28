// Shared configuration for the Stickerfolio k6 load test (issue #43).
// Values come from `--env KEY=VALUE` flags with sensible defaults so the same
// script serves the full 50-user test and the reduced CI smoke.

export const MODE = (__ENV.MODE || 'full').toLowerCase(); // 'full' | 'smoke'
export const IS_SMOKE = MODE === 'smoke';

// Number of concurrent authenticated users (Roadmap 4.1 / 12.3 target: ~50).
export const VUS = Number(__ENV.VUS || (IS_SMOKE ? 5 : 50));
export const DURATION = __ENV.DURATION || (IS_SMOKE ? '20s' : '2m');

// Header the target trusts for the real client IP (AUTH_TRUSTED_IP_HEADER on the
// server). When set, the script sends a distinct IP per VU so Better Auth's
// per-IP sign-in rate limit (5/min) does not distort a 50-user login burst.
// This mirrors running behind a trusted reverse proxy (Roadmap 10.2).
export function trustedIpHeader(config) {
  return __ENV.TRUSTED_IP_HEADER || config.authTrustedIpHeader || null;
}

// Roadmap 12 / issue #43 performance targets. These are the AUTHORITATIVE
// acceptance thresholds and are only meaningful on the target hardware
// (Raspberry Pi 4 baseline). They are intentionally NOT applied in smoke mode
// on CI runners, which are the wrong hardware (see README "Measurement boundary").
export const strictThresholds = {
  album_view_duration: ['p(95)<400'],
  trade_matching_duration: ['p(95)<1000'],
  quantity_update_duration: ['p(95)<200'],
  // Correctness invariants apply on every run, regardless of hardware.
  domain_errors: ['count<1'],
  write_consistency_errors: ['count<1'],
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
};

// Smoke thresholds prove the script executes end-to-end and that no domain
// error / read-after-write consistency error occurs, WITHOUT gating on the
// hardware-specific p95s.
export const smokeThresholds = {
  domain_errors: ['count<1'],
  write_consistency_errors: ['count<1'],
  checks: ['rate>0.99'],
};

export function baseUrl(config) {
  return (__ENV.BASE_URL || config.baseUrlHint || 'http://localhost:3500').replace(/\/$/, '');
}
