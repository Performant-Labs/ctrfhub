# CTRFHub — Load Testing Strategy

Load testing verifies that CTRFHub handles realistic and peak traffic without degrading response times, leaking resources, or violating its own rate limits. This is separate from functional testing — correctness is assumed; here we test behaviour under volume.

---

## Tools

| Tool | Purpose |
|---|---|
| **k6** | Primary load testing — scenarios, thresholds, CI integration |
| **autocannon** | Quick per-route benchmarks during development |

**Why k6:** JavaScript scripting (familiar syntax), first-class HTTP and SSE support, built-in thresholds that can gate CI, clean p50/p90/p99 output. No Java, no YAML-only config.

**Why autocannon:** Fastify uses it internally for its own benchmarks. `npx autocannon -c 50 -d 10 http://localhost:3000/...` gives instant feedback without a full k6 scenario.

---

## File structure

```
load-tests/
├── k6.config.json            ← shared options (VUs, thresholds, duration)
├── scenarios/
│   ├── ingest-flood.js       ← concurrent ingest from multiple tokens
│   ├── sse-saturation.js     ← ramp SSE connections to and beyond limits
│   ├── large-payload.js      ← single oversized CTRF report
│   ├── read-heavy.js         ← dashboard + run detail concurrent reads
│   ├── settings-contention.js ← concurrent PATCH on same org settings
│   └── realistic-mix.js      ← weighted mix of all traffic types
├── data/
│   ├── ctrf-tiny.json        ← 10 results (baseline)
│   ├── ctrf-medium.json      ← 200 results (typical CI suite)
│   ├── ctrf-large.json       ← 2 000 results (large suite / device farm)
│   └── ctrf-max.json         ← 10 000 results (stress upper bound)
└── helpers/
    ├── auth.js               ← obtain and cache API tokens
    └── metrics.js            ← custom metric helpers
```

---

## Performance baselines

Targets for a **single API container** (2 vCPU, 4 GB RAM) with PostgreSQL on the same host. These are the minimum acceptable numbers; faster is better.

| Scenario | Metric | Target |
|---|---|---|
| Ingest (200 results, no attachments) | p99 latency | < 500 ms |
| Ingest (200 results, no attachments) | Sustained RPS | ≥ 50 |
| Ingest error rate | Rate | < 1% |
| Run Detail page | p99 latency | < 200 ms |
| Run Detail page | Sustained RPS | ≥ 200 |
| Dashboard (run list) | p99 latency | < 150 ms |
| SSE connect + hold | Stable connections | 100 simultaneous |
| SSE memory growth | RSS after 5 min | < 50 MB growth |
| Large payload (2 000 results) | API remains responsive | Other routes p99 < 300 ms during insert |

---

## Scenarios

### 1. Ingest flood

**What it stresses:** The primary write path. Multiple CI pipelines posting CTRF reports concurrently.

**Key questions:**
- Does p99 stay under 500ms with 50 concurrent senders?
- Does rate limiting (per-token, per-hour) hold under parallel requests?
- Does the chunked insert `setImmediate` yield prevent other requests from starving?

```javascript
// load-tests/scenarios/ingest-flood.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { ctrfMedium } from '../data/ctrf-medium.json';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // ramp up
    { duration: '2m',  target: 50 },   // hold at 50 concurrent senders
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration:          ['p(99)<500'],
    http_req_failed:            ['rate<0.01'],
    errors:                     ['rate<0.01'],
  },
};

// Simulate 50 different project tokens
const tokens = Array.from({ length: 50 }, (_, i) => `load-test-token-${i}`);

export default function () {
  const token = tokens[__VU % tokens.length]; // each VU uses a dedicated token

  const res = http.post(
    'http://localhost:3000/api/v1/projects/load-test/runs',
    JSON.stringify(ctrfMedium),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': token,
      },
    }
  );

  errorRate.add(res.status !== 201);
  check(res, { 'status is 201': (r) => r.status === 201 });
  sleep(0.1); // 100ms think time
}
```

**What to watch:** Event loop lag (visible in Fastify's `--log-level debug` timing headers), DB connection pool wait time, memory growth in the API container.

---

### 2. SSE connection saturation

**What it stresses:** The in-memory SSE connection registry. Verifies per-user and per-org limits are enforced and that connections are cleaned up correctly on disconnect.

**Key questions:**
- Is the 429 `too_many_tabs` response returned at exactly the right connection count?
- Does the in-memory `sseRegistry` Map grow without bound if disconnects are not properly detected?
- Do keepalive pings (30s interval) hold connections open correctly?

```javascript
// load-tests/scenarios/sse-saturation.js
import { WebSocket } from 'k6/experimental/websockets'; // k6 uses EventSource via HTTP/2
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    below_limit: {
      executor: 'constant-vus',
      vus: 8,             // below per-user limit of 10
      duration: '2m',
      tags: { scenario: 'below_limit' },
    },
    at_limit: {
      executor: 'constant-vus',
      vus: 10,            // exactly at limit
      duration: '2m',
      startTime: '2m',
      tags: { scenario: 'at_limit' },
    },
    over_limit: {
      executor: 'constant-vus',
      vus: 15,            // over limit — should get 429
      duration: '2m',
      startTime: '4m',
      tags: { scenario: 'over_limit' },
    },
  },
  thresholds: {
    // In 'over_limit' scenario, 429 responses should occur and are expected
    'http_req_failed{scenario:below_limit}': ['rate<0.001'],
    'http_req_failed{scenario:at_limit}':    ['rate<0.05'],
  },
};

export default function () {
  const res = http.get('http://localhost:3000/api/sse/orgs/1', {
    headers: { Cookie: `session=${__ENV.TEST_SESSION}` },
    timeout: '65s', // hold connection for one keepalive cycle
  });

  // Over-limit connections should receive 429
  if (__ENV.K6_SCENARIO === 'over_limit') {
    check(res, { 'rate limited with 429': (r) => r.status === 429 });
  } else {
    check(res, { 'SSE connection accepted': (r) => r.status === 200 });
  }

  sleep(1);
}
```

**After the test:** Check API container memory with `docker stats`. RSS should return close to baseline after all connections close.

---

### 3. Large payload — event loop isolation

**What it stresses:** The chunked bulk insert (`setImmediate` yield) designed to keep the event loop responsive during large ingests.

**Key questions:**
- While a 2,000-result CTRF report is being ingested, do concurrent read requests (dashboard, run detail) remain fast?
- Does the per-run artifact size limit (1 GB) correctly reject oversized payloads?

```javascript
// load-tests/scenarios/large-payload.js
import http from 'k6/http';
import { check } from 'k6';
import { ctrfLarge } from '../data/ctrf-large.json'; // 2 000 results

export const options = {
  scenarios: {
    // Background: one VU continuously ingesting large reports
    large_ingest: {
      executor: 'constant-vus',
      vus: 1,
      duration: '3m',
    },
    // Foreground: 50 VUs hitting read routes while insert is happening
    concurrent_reads: {
      executor: 'constant-vus',
      vus: 50,
      duration: '3m',
    },
  },
  thresholds: {
    // Read routes must stay fast even while large inserts are in progress
    'http_req_duration{route:run-detail}': ['p(99)<300'],
    'http_req_duration{route:dashboard}':  ['p(99)<200'],
  },
};

export default function () {
  if (__ENV.K6_SCENARIO === 'large_ingest') {
    const res = http.post(
      'http://localhost:3000/api/v1/projects/load-test/runs',
      JSON.stringify(ctrfLarge),
      { headers: { 'Content-Type': 'application/json', 'x-api-token': 'large-ingest-token' } }
    );
    check(res, { 'large ingest accepted': (r) => r.status === 201 });
  } else {
    // Alternate between dashboard and run detail
    const isDetail = Math.random() > 0.5;
    const res = isDetail
      ? http.get('http://localhost:3000/runs/1', { tags: { route: 'run-detail' } })
      : http.get('http://localhost:3000/projects/load-test/runs', { tags: { route: 'dashboard' } });
    check(res, { 'read succeeded': (r) => r.status === 200 });
  }
}
```

**Pass condition:** While the 2,000-result insert is running, dashboard and run detail p99 stay under 300ms. If they degrade, the `setImmediate` chunk size needs tuning.

---

### 4. Concurrent settings saves (optimistic locking)

**What it stresses:** The `updated_at` optimistic locking on settings PATCH endpoints.

**Key questions:**
- With 20 users patching the same org settings field simultaneously, what is the 409 conflict rate?
- Do 409 responses include `updatedAt` so the client can retry?
- Is there any data corruption (last write should win, no partial writes)?

```javascript
// load-tests/scenarios/settings-contention.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 20,
  duration: '1m',
  thresholds: {
    // 409s are expected and handled — only 5xx is a real failure
    'http_req_failed': ['rate<0.001'], // anything other than 200/409
  },
};

let currentUpdatedAt = '2026-04-22T00:00:00.000Z'; // shared starting point

export default function () {
  const res = http.patch(
    'http://localhost:3000/org/settings/timezone',
    JSON.stringify({ value: 'America/Los_Angeles', updatedAt: currentUpdatedAt }),
    { headers: { 'Content-Type': 'application/json', Cookie: `session=${__ENV.TEST_SESSION}` } }
  );

  if (res.status === 200) {
    currentUpdatedAt = JSON.parse(res.body).updatedAt; // use fresh token for next attempt
  }

  check(res, {
    'response is 200 or 409': (r) => r.status === 200 || r.status === 409,
    'no 500 errors': (r) => r.status < 500,
  });
}
```

---

### 5. Realistic mixed traffic

**What it stresses:** Combined traffic — the closest to production conditions.

Traffic split (approximate):
- 70% reads (dashboard, run detail, run list)
- 20% ingest (CI pipelines posting CTRF)
- 5% settings reads/writes
- 5% SSE connections being established/dropped

```javascript
// load-tests/scenarios/realistic-mix.js
export const options = {
  scenarios: {
    reads:    { executor: 'constant-vus', vus: 70,  duration: '10m' },
    ingest:   { executor: 'constant-vus', vus: 20,  duration: '10m' },
    settings: { executor: 'constant-vus', vus: 5,   duration: '10m' },
    sse:      { executor: 'constant-vus', vus: 5,   duration: '10m' },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed:   ['rate<0.005'],
  },
};
```

Run duration: **10 minutes minimum.** Short runs hide slow memory leaks that compound over time.

---

### 6. Worker isolation under load

**What it stresses:** The architectural decision to separate the retention `worker` container from the `api` container.

**Procedure:**
1. Start the realistic-mix scenario (10 minutes)
2. At T+3m, manually trigger the retention cron: `docker exec ctrfhub_worker node -e "require('./dist/jobs/retention').runOnce()"`
3. Watch API p99 latency in k6 output during and after the retention run
4. Compare p99 before, during, and after the sweep

**Pass condition:** API p99 does not increase by more than 20% while the retention sweep is running. If it does, the worker is sharing resources with the API — check CPU affinity, DB connection pool sizing, or query planning.

---

### 7. AI pipeline burst and back-pressure

**What it stresses:** The AI pipeline (A1–A4) under sustained ingest load, with the managed-provider client stubbed to isolate CTRFHub-side behaviour from real LLM latency. Validates DD-017 (reserve-execute-commit + heartbeat + sweeper) end-to-end, the ceiling for in-flight AI pipeline rows on SQLite (`deployment-architecture.md` → SQLite graduation thresholds), and `@fastify/cors` behaviour on artifact URLs (gap-review item #10).

**Stubbed provider:** the test harness runs with `AI_PROVIDER=mock` — a test-only provider that returns a seeded response after a configurable latency drawn from `N(μ=800ms, σ=300ms)` with a 5% chance of a 2-second tail and a 2% chance of a 429 rate-limit response. This matches the observed distribution of real managed-provider responses without test runs costing money or hitting rate limits.

**Scenario A — categorization burst:**

```javascript
// k6/scenarios/ai-pipeline-burst.js
export const options = {
  scenarios: {
    ingest_burst: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 10,
      maxVUs: 30,
      stages: [
        { target: 5,  duration: '1m' },   // warm up
        { target: 30, duration: '2m' },   // burst — 30 ingests/sec
        { target: 30, duration: '5m' },   // sustain
        { target: 1,  duration: '1m' },   // cool down
      ],
    },
  },
  thresholds: {
    'http_req_duration{endpoint:ingest}': ['p(95)<2000'],
    'ai_pipeline_categorize_age_ms': ['p(95)<30000'],
    'ai_pipeline_pending_depth': ['max<200'],
    'ai_pipeline_failed_rate': ['rate<0.01'],
  },
};
```

Each ingest uploads a 200-failure CTRF payload so A1 has real batching work (10 chunks × 20 results).

**Scenario B — crash-recovery:**

1. Start Scenario A.
2. At T+3m (steady state), kill the worker container: `docker kill ctrfhub_worker`.
3. Wait 30 seconds, restart: `docker start ctrfhub_worker`.
4. Watch `ai_pipeline_log` for rows that were `running` when the worker died — they must transition to `pending` within 2 minutes (heartbeat timeout) and complete within 5 minutes of restart. No run should stay in `analyzing` state indefinitely.

**Scenario C — CORS preflight burst:**

Separate from A/B. Issues 100 req/sec of `OPTIONS` preflights and `GET` range requests against `/api/files/*` with `Origin: https://trace.playwright.dev` to verify the CORS config does not allocate (no per-request re-parsing of origin list) and that `Content-Range`/`Accept-Ranges` responses stream without buffering.

**Probed metrics (custom k6 `Trend` / `Counter`):**

| Metric | Source | Pass condition |
|---|---|---|
| `ai_pipeline_categorize_age_ms` | `NOW() - ai_pipeline_log.started_at` for completed A1 rows | p95 < 30s, p99 < 60s |
| `ai_pipeline_pending_depth` | `COUNT(*) FROM ai_pipeline_log WHERE status='pending'` | max < 200 during burst; returns to < 10 within 2m of cool-down |
| `ai_pipeline_failed_rate` | `SUM(status='failed') / COUNT(*)` | < 1% (above this, the 3-retry policy isn't absorbing normal jitter) |
| `run_analyzing_duration_ms` | `NOW() - test_runs.created_at` for runs where `ai_summary IS NULL AND ai_root_causes IS NULL` | p99 < 5m; no run stuck > 10m |
| `cors_preflight_duration_ms` | `http_req_duration{endpoint:options}` | p99 < 50ms |
| `sqlite_busy_rate` (SQLite only) | Fastify log scrape | < 1/min |

**Pass conditions:**

- API ingest p95 does not regress > 20% compared to Scenario 1 (ingest flood without AI pipeline active). If it does, the AI pipeline writes are colliding with ingest writes — re-check SQLite graduation thresholds.
- No `ai_pipeline_log` row sits in `pending` with `attempt >= 3` at end of run (the sweeper should have terminal-failed them).
- In Scenario B, every run ingested before the kill has `ai_summary IS NOT NULL` within 5 minutes of worker restart.
- In Scenario C, zero preflight failures and zero Range-request buffer allocations (verify with `docker stats` memory stability).

**Graduation signal:** if any of the pass conditions fail repeatedly on a deployment sized per the SQLite ceiling (`deployment-architecture.md` → SQLite graduation thresholds), that is the empirical signal to either (a) raise the ceiling numbers if the bottleneck is something other than writer contention, or (b) leave the ceiling as-is and graduate to PostgreSQL. This is the mechanism to replace the currently-estimated SQLite thresholds with measured values (see gap-review item #8).

---

## autocannon — development benchmarks

Use autocannon for quick per-route sanity checks during development, before committing a route change:

```bash
# Basic ingest benchmark
npx autocannon -c 50 -d 15 \
  -m POST \
  -H "content-type: application/json" \
  -H "x-api-token: bench-token" \
  -b "$(cat load-tests/data/ctrf-medium.json)" \
  http://localhost:3000/api/v1/projects/demo/runs

# Run detail read benchmark
npx autocannon -c 100 -d 15 \
  -H "Cookie: session=$TEST_SESSION" \
  http://localhost:3000/runs/1
```

Add `"bench": "node load-tests/bench.js"` as a package.json script that runs the most important routes sequentially and prints a comparison table.

---

## CI integration

Load tests are **not** run on every commit — they require a running instance and take minutes. They run:

1. **On release candidates** — before any version tag is cut
2. **On infrastructure changes** — Docker config, index changes, connection pool tuning
3. **Nightly** against a staging instance (optional, if staging exists)

```yaml
# .github/workflows/load-test.yml
on:
  workflow_dispatch:           # manual trigger
  schedule:
    - cron: '0 3 * * *'       # 3am nightly (staging only)

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: grafana/setup-k6-action@v1

      - name: Start CTRFHub via Docker Compose
        run: |
          cp .env.test .env
          docker compose up -d --wait

      - name: Seed load test data (tokens, projects)
        run: node load-tests/helpers/seed.js

      - name: Run ingest flood
        run: k6 run load-tests/scenarios/ingest-flood.js

      - name: Run SSE saturation
        run: k6 run load-tests/scenarios/sse-saturation.js

      - name: Run realistic mix (10m)
        run: k6 run load-tests/scenarios/realistic-mix.js

      - name: Collect container stats
        run: docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

k6 exits non-zero if any threshold is breached — the CI step fails automatically.

---

## What to measure beyond latency

| Metric | How to measure | Why |
|---|---|---|
| API container memory (RSS) | `docker stats` | SSE registry leak detection |
| Event loop lag | Fastify `--log-level debug` + custom header | Chunked insert effectiveness |
| DB connection pool wait | MikroORM `debug` logging | Pool exhaustion detection |
| PostgreSQL `pg_stat_activity` | Query during load test | Slow query + lock detection |
| Disk I/O | `docker stats` + `iostat` | Artifact write throughput |

---

## Known Node.js failure modes to watch for

| Failure mode | Symptom | Root cause in CTRFHub |
|---|---|---|
| Event loop starvation | Dashboard p99 spikes to seconds during large ingest | Chunk size too large; increase `setImmediate` frequency |
| SSE memory leak | RSS grows continuously; never returns to baseline | `close` event handler not registered correctly |
| DB pool exhaustion | `TimeoutError: acquiring connection timed out` | Pool size too small for concurrent VU count; raise `pool.max` |
| Rate limit bypass | More than `rate_limit_per_hour` requests accepted | Race condition in atomic counter; test with Redis rate limit store |
| Connection spike on SSE reconnect | 429s during reconnect wave | SSE reconnect back-off not implemented on client (HTMX SSE default) |

---

## Load test data seeding

The k6 scenarios require pre-seeded data (project token, org, project):

```javascript
// load-tests/helpers/seed.js — run once before k6 scenarios
import { MikroORM } from '@mikro-orm/postgresql';

const orm = await MikroORM.init(config);
const em = orm.em.fork();

// Create load-test org + project
const org = em.create(Organization, { name: 'Load Test Org', slug: 'load-test-org' });
const project = em.create(Project, { organization: org, name: 'Load Test', slug: 'load-test' });

// Create 50 project tokens (one per VU in ingest-flood)
for (let i = 0; i < 50; i++) {
  em.create(ProjectToken, {
    project,
    token: `load-test-token-${i}`,
    rateLimitPerHour: 10_000, // unlimited for load tests
  });
}

await em.flush();
await orm.close();
console.log('Seeded load test data.');
```

---

*Last updated: 2026-04-22*
