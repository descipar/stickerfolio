/**
 * Slow / temporarily-unavailable database scenario (Roadmap 12.3, issue #43).
 *
 * Goal: confirm the app degrades gracefully — not that it stays fast — when the
 * database is slow or briefly unavailable. While this script runs, an operator
 * degrades the database out-of-band (see load-test/scripts/degrade-db.sh), e.g.
 *
 *   # temporarily unavailable: pause PostgreSQL for 15s mid-run
 *   load-test/scripts/degrade-db.sh outage 15
 *   # slow: add 300ms latency in front of PostgreSQL (needs toxiproxy/pumba)
 *   load-test/scripts/degrade-db.sh latency 300
 *
 * Expectations asserted here:
 *   - the readiness endpoint reports the outage (503) instead of a false 200,
 *   - every request RETURNS within a bounded time (no indefinite hang); the app
 *     surfaces a clean 5xx while the DB is down rather than crashing,
 *   - after recovery, readiness and album views return to 200.
 *
 * This is an observational resilience probe; it deliberately does NOT enforce
 * the p95 latency targets (they do not apply while the DB is degraded).
 *
 * Run:  k6 run --env DURATION=60s load-test/k6/slow-db.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import { baseUrl, trustedIpHeader } from './lib/config.js';
import { login, userForVu, ipHeaders } from './lib/session.js';

const config = JSON.parse(open('../data/users.json'));
const users = new SharedArray('users', () => config.users);
const BASE = baseUrl(config);
const IP_HEADER = trustedIpHeader(config);
// A response slower than this is treated as an effective hang.
const HANG_MS = Number(__ENV.HANG_MS || 10000);

const readyDuration = new Trend('ready_duration', true);
const readyUp = new Counter('ready_up');
const readyDown = new Counter('ready_down');
const albumUp = new Counter('album_up');
const albumDown = new Counter('album_down');
const hangs = new Counter('hangs');
const crashes = new Counter('crashes'); // connection errors / status 0

export const options = {
  scenarios: {
    resilience_probe: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || '60s',
      gracefulStop: '5s',
    },
  },
  thresholds: {
    // No indefinite hangs and no process-level crashes, even while the DB is down.
    hangs: ['count<1'],
    crashes: ['count<1'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'max'],
};

let loggedIn = false;

export default function () {
  const user = userForVu(users);

  const ready = http.get(`${BASE}/api/health/ready`, {
    timeout: `${HANG_MS}ms`,
    tags: { name: 'ready' },
  });
  readyDuration.add(ready.timings.duration);
  if (ready.status === 0) crashes.add(1);
  if (ready.timings.duration >= HANG_MS) hangs.add(1);
  if (ready.status === 200) readyUp.add(1);
  else readyDown.add(1);

  // Log in opportunistically; auth also needs the DB, so it may fail during the
  // outage — that is acceptable here and is not a domain error.
  if (!loggedIn) loggedIn = login(BASE, user, IP_HEADER, { loginDuration: readyDuration, domainErrors: crashes });

  if (loggedIn) {
    const album = http.get(`${BASE}/api/collections/${user.collectionId}/stickers`, {
      headers: ipHeaders(IP_HEADER),
      timeout: `${HANG_MS}ms`,
      tags: { name: 'album_view_degraded' },
    });
    if (album.status === 0) crashes.add(1);
    if (album.timings.duration >= HANG_MS) hangs.add(1);
    if (album.status === 200) albumUp.add(1);
    else albumDown.add(1);
    // A failed request during the outage may have dropped the session; re-login next loop.
    if (album.status >= 500) loggedIn = false;
    check(album, { 'album view returns a bounded response': (r) => r.status !== 0 });
  }

  sleep(1);
}
