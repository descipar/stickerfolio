// Authentication + per-VU identity helpers for the k6 load test.
// Login uses the real Better Auth email/password endpoint; the session cookie
// is stored in the VU's cookie jar and reused on subsequent requests.
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

// A stable, unique IP per VU (10.x.x.x). Sent in the trusted IP header so each
// simulated user is rate-limited independently, matching real distinct clients.
export function vuClientIp() {
  const id = exec.vu.idInTest; // 1-based, unique across the test
  const a = 10 + ((id >> 16) & 0x3f);
  const b = (id >> 8) & 0xff;
  const c = id & 0xff;
  return `${a}.${b}.${c}.${(id % 254) + 1}`;
}

export function ipHeaders(headerName) {
  return headerName ? { [headerName]: vuClientIp() } : {};
}

// Picks this VU's user deterministically from the seeded set.
export function userForVu(users) {
  return users[(exec.vu.idInTest - 1) % users.length];
}

export function login(base, user, headerName, metrics) {
  const res = http.post(
    `${base}/api/auth/sign-in/email`,
    JSON.stringify({ email: user.email, password: user.password }),
    {
      headers: { 'Content-Type': 'application/json', ...ipHeaders(headerName) },
      tags: { name: 'login', op: 'login' },
    },
  );
  metrics.loginDuration.add(res.timings.duration);
  const ok = check(res, { 'login returns 200': (r) => r.status === 200 });
  // Some resilience scenarios expect authentication to fail while the
  // database is unavailable and therefore deliberately omit domainErrors.
  if (!ok && metrics.domainErrors) metrics.domainErrors.add(1);
  return ok;
}
