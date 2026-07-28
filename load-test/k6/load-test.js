/**
 * Stickerfolio load test — 50 concurrent authenticated users (Roadmap 12.3, #43).
 *
 * Simulates ~50 concurrent authenticated collectors exercising the four core
 * operations, each measured separately so the roadmap p95 targets apply
 * per operation:
 *
 *   - login            POST /api/auth/sign-in/email          (login under load)
 *   - album view       GET  /api/collections/{id}/stickers   p95 < 400 ms
 *   - quantity update  PUT  /api/collections/{id}/holdings/{stickerId}  p95 < 200 ms
 *   - trade matching   GET  /api/collections/{id}/trades      p95 < 1000 ms
 *
 * Correctness guards (hardware-independent):
 *   - domain_errors: any unexpected non-2xx from a domain endpoint.
 *   - write_consistency_errors: read-after-write mismatch on a quantity update.
 *
 * The dataset (credentials, collection ids, sections) is produced by
 * load-test/seed/seed-load-dataset.ts into load-test/data/users.json.
 *
 * Run:
 *   k6 run load-test/k6/load-test.js                        # full 50-user test
 *   k6 run --env MODE=smoke load-test/k6/load-test.js       # reduced CI smoke
 *   k6 run --env BASE_URL=http://pi.local:3500 load-test/k6/load-test.js
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import {
  IS_SMOKE,
  VUS,
  DURATION,
  baseUrl,
  trustedIpHeader,
  strictThresholds,
  smokeThresholds,
} from './lib/config.js';
import { login, userForVu, ipHeaders } from './lib/session.js';

const config = JSON.parse(open('../data/users.json'));
const users = new SharedArray('users', () => config.users);
const sections = config.sections || [];

const BASE = baseUrl(config);
const IP_HEADER = trustedIpHeader(config);

const metrics = {
  loginDuration: new Trend('login_duration', true),
  albumViewDuration: new Trend('album_view_duration', true),
  quantityUpdateDuration: new Trend('quantity_update_duration', true),
  tradeMatchingDuration: new Trend('trade_matching_duration', true),
  domainErrors: new Counter('domain_errors'),
  writeConsistencyErrors: new Counter('write_consistency_errors'),
};

export const options = {
  scenarios: {
    concurrent_collectors: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      gracefulStop: '10s',
    },
  },
  thresholds: IS_SMOKE ? smokeThresholds : strictThresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// Per-VU state (init once per VU instance).
let loggedIn = false;
let stickerCache = null;

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function reqHeaders() {
  return { headers: ipHeaders(IP_HEADER) };
}

function albumView(user) {
  const res = http.get(`${BASE}/api/collections/${user.collectionId}/stickers`, {
    ...reqHeaders(),
    tags: { name: 'album_view', op: 'album_view' },
  });
  metrics.albumViewDuration.add(res.timings.duration);
  const ok = check(res, {
    'album view 200': (r) => r.status === 200,
    'album view has stickers': (r) => {
      try {
        const body = r.json();
        return Array.isArray(body.stickers) && body.stickers.length > 0;
      } catch {
        return false;
      }
    },
  });
  if (!ok) {
    metrics.domainErrors.add(1);
    return;
  }
  stickerCache = res.json('stickers');
}

function quantityUpdate(user) {
  if (!stickerCache || stickerCache.length === 0) {
    albumView(user);
    if (!stickerCache || stickerCache.length === 0) return;
  }
  const sticker = randomItem(stickerCache);
  const quantity = Math.floor(Math.random() * 4); // 0..3
  const res = http.put(
    `${BASE}/api/collections/${user.collectionId}/holdings/${sticker.id}`,
    JSON.stringify({ quantity }),
    {
      headers: { 'Content-Type': 'application/json', ...ipHeaders(IP_HEADER) },
      tags: { name: 'quantity_update', op: 'quantity_update' },
    },
  );
  metrics.quantityUpdateDuration.add(res.timings.duration);
  const ok = check(res, { 'quantity update 200': (r) => r.status === 200 });
  if (!ok) {
    metrics.domainErrors.add(1);
    return;
  }

  // Read-after-write consistency guard. Each VU only mutates its OWN holdings,
  // so this verifies persistence and isolation across collectors. It does not
  // claim to test concurrent writes to the same holding. Sampled to limit extra
  // read load.
  if (IS_SMOKE || Math.random() < 0.2) {
    const verify = http.get(`${BASE}/api/collections/${user.collectionId}/stickers`, {
      ...reqHeaders(),
      tags: { name: 'quantity_verify', op: 'quantity_verify' },
    });
    if (verify.status === 200) {
      let found;
      try {
        found = verify.json('stickers').find((s) => s.id === sticker.id);
      } catch {
        found = undefined;
      }
      const observed = found ? found.quantity : 0; // quantity 0 => no holding row
      const consistent = observed === quantity;
      check(verify, { 'read-after-write consistent': () => consistent });
      if (!consistent) metrics.writeConsistencyErrors.add(1);
      stickerCache = verify.json('stickers');
    }
  }
}

function tradeMatching(user) {
  let url = `${BASE}/api/collections/${user.collectionId}/trades?direction=all&sort=compatibility&limit=20`;
  if (sections.length > 0 && Math.random() < 0.3) {
    url += `&section=${randomItem(sections).id}`;
  }
  const res = http.get(url, { ...reqHeaders(), tags: { name: 'trade_matching', op: 'trade_matching' } });
  metrics.tradeMatchingDuration.add(res.timings.duration);
  const ok = check(res, {
    'trade matching 200': (r) => r.status === 200,
    'trade matching well formed': (r) => {
      try {
        const body = r.json();
        return typeof body.enabled === 'boolean' && Array.isArray(body.matches);
      } catch {
        return false;
      }
    },
  });
  if (!ok) metrics.domainErrors.add(1);
}

export default function () {
  const user = userForVu(users);

  if (!loggedIn) {
    if (!login(BASE, user, IP_HEADER, metrics)) {
      sleep(1);
      return;
    }
    loggedIn = true;
  }

  // Album views dominate; quantity updates and trade matching interleave so all
  // four operations run under sustained 50-user concurrency.
  const roll = Math.random();
  group('album view', () => albumView(user));
  if (roll < 0.5) group('quantity update', () => quantityUpdate(user));
  if (roll > 0.7) group('trade matching', () => tradeMatching(user));

  // Periodically re-authenticate to keep login traffic flowing under load.
  if (__ITER > 0 && __ITER % 25 === 0) loggedIn = false;

  sleep(0.5 + Math.random()); // 0.5–1.5s think time
}
