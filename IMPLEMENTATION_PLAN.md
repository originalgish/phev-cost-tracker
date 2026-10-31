# PHEV Home Charging Cost Tracker: Low-Level Implementation Plan

This plan is the build order for the tracker. [specs/](specs/README.md) defines how the tracker behaves, [PLAN.md](PLAN.md) explains why, and this file says what to build next, in what order. A cheaper model can follow it without making design decisions.

All code in this file was compiled and tested before it was written down. The project was rebuilt from this markdown alone, one task at a time (see [Verification](#verification-already-done)).

## How to use this plan

Rules for the implementer:

1. **Read the spec first.** Each task lists the requirements it implements. Read them in `specs/` before starting.
2. **Work in order.** Do one task at a time. Do not skip ahead or merge tasks.
3. **Copy code exactly.** Every block headed `File:` is the full content of that file. Create it as written. Do not refactor, rename or "improve" it. If a later task gives the same file again, replace the whole file.
4. **The spec wins.** If the code here, a test or anything else disagrees with a spec, stop and ask the user. Do not change a spec without the user's approval. Do not change tests to make them pass.
5. **Do not make design decisions.** If a check fails, follow [Troubleshooting](#troubleshooting). If that does not fix it, stop and ask the user.
6. **Run the checks in every task.** A task is finished only when every "Done when" item is true.
7. **Commit and push after each task** using the message given, on `main`. Stage only the files listed in that task. Never force-push.
8. **Stop at `[HUMAN]` tasks.** They need the user's Cloudflare login, phone or car. Print the steps, wait for the user, then continue.
9. **Never put secrets anywhere.** The repository is public. The API key, the real VIN and raw API output must not appear in code, tests, logs, commits or chat. Tests use the example VIN from the Škoda spec, `TMBJB9NY5RF999999`.
10. **Never print the home position.** Do not `SELECT` `home_lat` or `home_lon`, and do not `SELECT *` from `settings`, against the remote database.

Requirements: Node 22 or newer, pnpm 12. Run every command from the project root.

## Project layout

```text
phev-cost-tracker/
├── PLAN.md, IMPLEMENTATION_PLAN.md, CLAUDE.md, probe.py
├── specs/                  source of truth for behaviour
├── package.json, pnpm-workspace.yaml, tsconfig.json
├── vitest.config.ts, wrangler.jsonc
├── .gitignore, .dev.vars.example
├── migrations/0001_init.sql
├── scripts/                spec check, local seed data
├── public/                 static dashboard
├── src/
│   ├── index.ts            Worker entry: fetch and scheduled
│   ├── routes.ts           health, settings, setup
│   ├── session-routes.ts   months, sessions, maintenance
│   ├── auth.ts             Access JWT check
│   ├── poll.ts             one poll, end to end
│   ├── gate.ts             when to poll, when to back off (pure)
│   ├── skoda.ts            API client
│   ├── sample.ts           API response to Sample, at-home decision
│   ├── session.ts          session state machine (pure)
│   ├── session-store.ts    state machine to D1 statements
│   ├── maintenance.ts      rebuild sessions, recompute costs
│   ├── cost.ts             energy choice and cost (pure)
│   ├── settings.ts         typed settings
│   ├── geo.ts              distance (pure)
│   └── alerts.ts           alert rules and webhook
└── test/
```

---

## Phase 0: Project setup

### Task 0.1 `[HUMAN]` Replace the exposed API key

**Done on 2026-10-31.** The old key is revoked and a new one is stored safely.

### Task 0.2 `[MODEL]` First commit

**Done on 2026-10-31.** The first commit holds `PLAN.md`, this file, `probe.py`, `CLAUDE.md`, `specs/` and the file below.

**File: `.gitignore`**

```gitignore
node_modules/
.wrangler/
.dev.vars
worker-configuration.d.ts
probe-output.json
dist-check/
```

### Task 0.3 `[MODEL]` Scaffold the Worker

Create these files.

**File: `package.json`**

```json
{
  "name": "phev-cost-tracker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --test-scheduled",
    "test": "vitest run",
    "typecheck": "wrangler types && tsc --noEmit",
    "check:specs": "node scripts/check-specs.mjs",
    "check": "pnpm test && pnpm typecheck && pnpm check:specs",
    "migrate:local": "wrangler d1 migrations apply phev-cost-tracker --local",
    "migrate:remote": "wrangler d1 migrations apply phev-cost-tracker --remote",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "hono": "4.13.14",
    "jose": "6.2.14"
  },
  "devDependencies": {
    "@cloudflare/vitest-plugin": "1.4.11",
    "chart.js": "4.6.1",
    "typescript": "7.0.2",
    "vitest": "5.0.5",
    "wrangler": "4.156.0"
  }
}
```

**File: `pnpm-workspace.yaml`**

```yaml
allowBuilds:
  esbuild: false
  workerd: false
```

**File: `wrangler.jsonc`**

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "phev-cost-tracker",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-15",
  "workers_dev": true,
  "preview_urls": false,
  "observability": { "enabled": true },
  "triggers": { "crons": ["*/5 * * * *"] },
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*", "/setup/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "phev-cost-tracker",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ],
  "vars": {
    "ACCESS_TEAM_DOMAIN": "https://REPLACE-ME.cloudflareaccess.com",
    "ACCESS_AUD": "REPLACE-ME",
    "TIMEZONE": "Europe/Helsinki"
  }
}
```

**File: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2024"],
    "types": ["./worker-configuration.d.ts", "@cloudflare/vitest-plugin/types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test", "worker-configuration.d.ts", "vitest.config.ts"]
}
```

**File: `vitest.config.ts`**

```ts
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SKODA_API_KEY: "test-key",
            SKODA_VIN: "TMBJB9NY5RF999999",
            ALERT_WEBHOOK_URL: "",
            DEV_AUTH_BYPASS: "",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
```

**File: `.dev.vars.example`**

```dotenv
SKODA_API_KEY=dev-placeholder
SKODA_VIN=TMBJB9NY5RF999999
ALERT_WEBHOOK_URL=
DEV_AUTH_BYPASS=1
```

**File: `src/index.ts`**

```ts
export default {
  fetch: () => new Response("not implemented", { status: 501 }),
} satisfies ExportedHandler<Env>;
```

**File: `public/index.html`**

```html
<!doctype html>
<title>PHEV Cost Tracker</title>
<p>Not built yet.</p>
```

**File: `test/apply-migrations.ts`**

```ts
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

**File: `test/env.d.ts`**

```ts
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

**File: `scripts/check-specs.mjs`**

```js
// Fails if a test names an unknown requirement. With a phase argument, also fails
// if a `Verified by: test` requirement up to that phase has no test.
import { readdirSync, readFileSync } from "node:fs";

const SPEC_DIR = "specs";
const TEST_DIR = "test";
const ID = /\b(?:POLL|HOME|SES|COST|API|SEC|ALERT|DASH|OPS)-\d+\b/g;
const HEADING = /^### ([A-Z]+-\d+): .+\n\nPhase: (\d+)\. Verified by: (test|manual)\.$/gm;

const phase = process.argv[2] === undefined ? null : Number(process.argv[2]);
const problems = [];
const requirements = new Map();

for (const file of readdirSync(SPEC_DIR)) {
  if (!file.endsWith(".md") || file === "README.md") continue;
  const text = readFileSync(`${SPEC_DIR}/${file}`, "utf8");
  const headings = text.match(/^### .+$/gm) ?? [];
  const parsed = [...text.matchAll(HEADING)];
  if (headings.length !== parsed.length) problems.push(`${file}: a requirement heading is missing its "Phase: N. Verified by: x." line`);
  for (const [, id, reqPhase, verifiedBy] of parsed) {
    if (requirements.has(id)) problems.push(`${id}: defined twice`);
    requirements.set(id, { phase: Number(reqPhase), verifiedBy });
  }
}

const covered = new Set();
for (const file of readdirSync(TEST_DIR)) {
  if (!file.endsWith(".test.ts")) continue;
  const text = readFileSync(`${TEST_DIR}/${file}`, "utf8");
  const titles = text.match(/\b(?:it|describe)(?:\.each\([\s\S]*?\))?\(\s*["'`].*["'`]/g) ?? [];
  for (const title of titles) {
    for (const [id] of title.matchAll(ID)) {
      if (!requirements.has(id)) problems.push(`${file}: unknown requirement ${id}`);
      covered.add(id);
    }
  }
}

if (phase !== null) {
  for (const [id, req] of requirements) {
    if (req.verifiedBy === "test" && req.phase <= phase && !covered.has(id)) problems.push(`${id}: no test`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${requirements.size} requirements, ${covered.size} covered by tests`);
```


Then run:

```bash
cp .dev.vars.example .dev.vars
pnpm install
```

The `pnpm-workspace.yaml` file is required. Without it, `pnpm install --frozen-lockfile` fails with `ERR_PNPM_IGNORED_BUILDS`. Neither package needs its build script.

**Done when:** `pnpm install` exits 0 and `pnpm check:specs` prints the requirement count.

**Commit:** `chore: scaffold Cloudflare Worker project`. Stage everything above and `pnpm-lock.yaml`.

### Task 0.4 `[MODEL]` Database schema

Create the migration and a smoke test.

**File: `migrations/0001_init.sql`**

```sql
-- One row per distinct charging.carCapturedTimestamp. No GPS, by design.
CREATE TABLE snapshot (
  captured_at     INTEGER PRIMARY KEY,   -- unix seconds
  plug_state      TEXT,
  charge_state    TEXT,
  charge_power_kw REAL,
  soc_percent     INTEGER,
  odometer_km     INTEGER,
  at_home         INTEGER CHECK (at_home IN (0, 1))  -- NULL = unknown
);

CREATE TABLE charge_session (
  id              INTEGER PRIMARY KEY,
  status          TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  started_at      INTEGER NOT NULL UNIQUE,
  ended_at        INTEGER,
  end_reason      TEXT CHECK (end_reason IN ('unplugged', 'charge_ended', 'stale')),
  local_month     TEXT NOT NULL,         -- 'YYYY-MM' in TIMEZONE, at session start
  start_soc       INTEGER,
  end_soc         INTEGER,
  last_sample_at  INTEGER NOT NULL,
  last_power_kw   REAL,
  kwh_by_power    REAL NOT NULL DEFAULT 0,
  gap_count       INTEGER NOT NULL DEFAULT 0,
  kwh_by_soc      REAL,
  kwh_used        REAL,
  kwh_source      TEXT CHECK (kwh_source IN ('power', 'soc')),
  cost_energy_c   REAL,
  cost_transfer_c REAL,
  cost_tax_c      REAL,
  cost_total_c    REAL
);
CREATE UNIQUE INDEX charge_session_one_open ON charge_session (status) WHERE status = 'open';
CREATE INDEX charge_session_month ON charge_session (local_month);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('energy_price_c_per_kwh', '8'),
  ('transfer_price_c_per_kwh', '0'),
  ('electricity_tax_c_per_kwh', '0'),
  ('battery_usable_kwh', '20'),
  ('home_radius_m', '50'),
  ('poll_interval_plugged_min', '10'),
  ('poll_interval_idle_min', '15'),
  ('max_gap_min', '45'),
  ('session_stale_min', '180'),
  ('cost_energy_source', 'power');

CREATE TABLE poll_state (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  last_poll_at        INTEGER,
  last_success_at     INTEGER,
  not_before          INTEGER,
  last_captured_at    INTEGER,
  last_plug_state     TEXT,
  last_at_home        INTEGER,
  key_expires_at      INTEGER,
  rate_limit_remaining INTEGER,
  auth_failures       INTEGER NOT NULL DEFAULT 0,
  rate_limit_failures INTEGER NOT NULL DEFAULT 0
);
INSERT INTO poll_state (id) VALUES (1);

CREATE TABLE poll_error (
  id           INTEGER PRIMARY KEY,
  at           INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  http_status  INTEGER,
  problem_type TEXT
);
CREATE INDEX poll_error_at ON poll_error (at);

CREATE TABLE alert_log (
  key          TEXT PRIMARY KEY,
  last_sent_at INTEGER NOT NULL
);
```

**File: `test/smoke.test.ts`**

```ts
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("applies the schema and seeds", async () => {
  const state = await env.DB.prepare("SELECT id FROM poll_state").first();
  expect(state).toEqual({ id: 1 });
  const price = await env.DB.prepare("SELECT value FROM settings WHERE key = 'energy_price_c_per_kwh'").first();
  expect(price).toEqual({ value: "8" });
});
```


`vat_percent`, the three `*_includes_vat` flags, `home_lat` and `home_lon` are not seeded on purpose. They stay absent until the user sets them.

Run:

```bash
pnpm check
pnpm migrate:local
```

**Done when:** `pnpm check` passes and `0001_init.sql` shows as applied.

**Commit:** `feat: add database schema`.

---

## Phase 1: Collector

Goal: a deployed Worker that stores a snapshot whenever the car reports something new. No sessions or cost yet.

### Task 1.1 `[MODEL]` Pure helpers

**Implements:** POLL-1, POLL-2, POLL-6, POLL-7, HOME-1, SES-9, COST-1, COST-2 (logic only).

`settings.ts` imports types from `cost.ts`, so `cost.ts` is built now even though sessions come later.

**File: `src/geo.ts`**

```ts
const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export type LatLon = { latitude: number; longitude: number };

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
```

**File: `src/cost.ts`**

```ts
export type Prices = {
  energyC: number;
  energyIncludesVat: boolean;
  transferC: number;
  transferIncludesVat: boolean;
  taxC: number;
  taxIncludesVat: boolean;
  vatPercent: number;
};

export type EnergySource = "power" | "soc";

export type EnergyChoice = { kwh: number; source: EnergySource } | null;

export type Cost = { energyC: number; transferC: number; taxC: number; totalC: number };

export function kwhBySoc(startSoc: number | null, endSoc: number | null, batteryUsableKwh: number): number | null {
  if (startSoc === null || endSoc === null) return null;
  return (Math.max(0, endSoc - startSoc) / 100) * batteryUsableKwh;
}

// The power estimate is only used when every interval was integrated.
export function chooseEnergy(kwhByPower: number, gapCount: number, bySoc: number | null, preferred: EnergySource): EnergyChoice {
  const powerUsable = gapCount === 0 && kwhByPower > 0;
  if (preferred === "power" && powerUsable) return { kwh: kwhByPower, source: "power" };
  if (bySoc !== null) return { kwh: bySoc, source: "soc" };
  return powerUsable ? { kwh: kwhByPower, source: "power" } : null;
}

export function sessionCost(kwh: number, p: Prices): Cost {
  const withVat = (c: number, included: boolean) => (included ? c : c * (1 + p.vatPercent / 100));
  const energyC = kwh * withVat(p.energyC, p.energyIncludesVat);
  const transferC = kwh * withVat(p.transferC, p.transferIncludesVat);
  const taxC = kwh * withVat(p.taxC, p.taxIncludesVat);
  return { energyC, transferC, taxC, totalC: energyC + transferC + taxC };
}
```

**File: `src/gate.ts`**

```ts
export type GateInput = {
  lastPollAt: number | null;
  notBefore: number | null;
  lastPlugState: string | null;
  pluggedIntervalMin: number;
  idleIntervalMin: number;
};

export type BackoffInput = {
  failureKind: string | null;
  retryAfterSeconds: number | null;
  rateRemaining: number | null;
  rateResetSeconds: number | null;
  authFailures: number;
};

// Cron timing is best-effort, so a tick up to a minute early still counts.
const EARLY_TOLERANCE_SECONDS = 60;
const AUTH_FAILURE_LIMIT = 3;
const AUTH_BACKOFF_SECONDS = 3600;
const DEFAULT_RATE_LIMIT_BACKOFF_SECONDS = 3600;

export function shouldPoll(nowSec: number, g: GateInput): boolean {
  if (g.notBefore !== null && nowSec < g.notBefore) return false;
  if (g.lastPollAt === null) return true;
  const minutes = g.lastPlugState === "CONNECTED" ? g.pluggedIntervalMin : g.idleIntervalMin;
  return nowSec - g.lastPollAt >= minutes * 60 - EARLY_TOLERANCE_SECONDS;
}

export function nextNotBefore(nowSec: number, b: BackoffInput): number | null {
  if (b.failureKind === "rate_limit") return nowSec + (b.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_BACKOFF_SECONDS);
  if (b.failureKind !== null && b.retryAfterSeconds !== null) return nowSec + b.retryAfterSeconds;
  if (b.failureKind === "auth" && b.authFailures >= AUTH_FAILURE_LIMIT) return nowSec + AUTH_BACKOFF_SECONDS;
  if (b.rateRemaining !== null && b.rateRemaining <= 1 && b.rateResetSeconds !== null) return nowSec + b.rateResetSeconds;
  return null;
}
```

**File: `test/geo.test.ts`**

```ts
import { expect, it } from "vitest";
import { distanceM } from "../src/geo";

it("HOME-1 measures short distances", () => {
  const d = distanceM({ latitude: 60.17, longitude: 24.94 }, { latitude: 60.1704, longitude: 24.94 });
  expect(d).toBeGreaterThan(44);
  expect(d).toBeLessThan(45);
});

it("HOME-1 is zero for the same point", () => {
  expect(distanceM({ latitude: 60.17, longitude: 24.94 }, { latitude: 60.17, longitude: 24.94 })).toBe(0);
});
```

**File: `test/cost.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { chooseEnergy, kwhBySoc, sessionCost } from "../src/cost";

describe("COST-1 sessionCost", () => {
  it("adds VAT only to components that exclude it", () => {
    const cost = sessionCost(10, {
      energyC: 8,
      energyIncludesVat: false,
      transferC: 5,
      transferIncludesVat: true,
      taxC: 2,
      taxIncludesVat: false,
      vatPercent: 25,
    });
    expect(cost.energyC).toBeCloseTo(100);
    expect(cost.transferC).toBeCloseTo(50);
    expect(cost.taxC).toBeCloseTo(25);
    expect(cost.totalC).toBeCloseTo(175);
  });
});

describe("SES-9 kwhBySoc", () => {
  it("scales by usable capacity", () => expect(kwhBySoc(20, 80, 20)).toBeCloseTo(12));
  it("is null when a reading is missing", () => expect(kwhBySoc(null, 80, 20)).toBeNull());
  it("never goes negative", () => expect(kwhBySoc(80, 70, 20)).toBe(0));
});

describe("COST-2 chooseEnergy", () => {
  it("uses power when it has no gaps", () => expect(chooseEnergy(5, 0, 6, "power")).toEqual({ kwh: 5, source: "power" }));
  it("falls back to SoC when power has gaps", () => expect(chooseEnergy(5, 1, 6, "power")).toEqual({ kwh: 6, source: "soc" }));
  it("honours a SoC preference", () => expect(chooseEnergy(5, 0, 6, "soc")).toEqual({ kwh: 6, source: "soc" }));
  it("falls back to power when SoC is missing", () => expect(chooseEnergy(5, 0, null, "soc")).toEqual({ kwh: 5, source: "power" }));
  it("gives nothing when neither is usable", () => expect(chooseEnergy(0, 0, null, "power")).toBeNull());
});
```

**File: `test/gate.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { nextNotBefore, shouldPoll } from "../src/gate";

const gate = { notBefore: null, pluggedIntervalMin: 10, idleIntervalMin: 15 };
const ok = { failureKind: null, retryAfterSeconds: null, rateRemaining: 10, rateResetSeconds: 100, authFailures: 0 };

describe("POLL-1 shouldPoll", () => {
  it("polls when it has never polled", () => expect(shouldPoll(1000, { ...gate, lastPollAt: null, lastPlugState: null })).toBe(true));
  it("waits 15 minutes when idle, less the tolerance", () => {
    expect(shouldPoll(840, { ...gate, lastPollAt: 0, lastPlugState: "DISCONNECTED" })).toBe(true);
    expect(shouldPoll(839, { ...gate, lastPollAt: 0, lastPlugState: "DISCONNECTED" })).toBe(false);
  });
  it("waits 10 minutes when plugged in", () => expect(shouldPoll(540, { ...gate, lastPollAt: 0, lastPlugState: "CONNECTED" })).toBe(true));
  it("POLL-2 respects not_before", () => expect(shouldPoll(900, { ...gate, notBefore: 901, lastPollAt: 0, lastPlugState: null })).toBe(false));
});

describe("nextNotBefore", () => {
  it("is null when healthy", () => expect(nextNotBefore(100, ok)).toBeNull());
  it("POLL-6 honours Retry-After on 429", () => expect(nextNotBefore(100, { ...ok, failureKind: "rate_limit", retryAfterSeconds: 60 })).toBe(160));
  it("POLL-6 defaults to an hour on 429", () => expect(nextNotBefore(100, { ...ok, failureKind: "rate_limit" })).toBe(3700));
  it("POLL-7 honours Retry-After on 503", () => expect(nextNotBefore(100, { ...ok, failureKind: "server", retryAfterSeconds: 30 })).toBe(130));
  it("POLL-7 backs off after three auth failures", () => {
    expect(nextNotBefore(100, { ...ok, failureKind: "auth", authFailures: 2 })).toBeNull();
    expect(nextNotBefore(100, { ...ok, failureKind: "auth", authFailures: 3 })).toBe(3700);
  });
  it("POLL-7 pauses when the quota is nearly gone", () => expect(nextNotBefore(100, { ...ok, rateRemaining: 1 })).toBe(200));
});
```


**Done when:** `pnpm check` passes.

**Commit:** `feat: add distance, cost and polling gate helpers`.

### Task 1.2 `[MODEL]` Settings and Škoda client

**Implements:** POLL-3, POLL-6, POLL-8, POLL-10, SEC-4.

**File: `src/settings.ts`**

```ts
import type { EnergySource, Prices } from "./cost";

export type Settings = {
  homeLat: number | null;
  homeLon: number | null;
  homeRadiusM: number;
  batteryUsableKwh: number;
  pluggedIntervalMin: number;
  idleIntervalMin: number;
  maxGapMin: number;
  sessionStaleMin: number;
  costEnergySource: EnergySource;
  prices: Prices | null; // null until every price field is filled in
};

type Raw = Record<string, string>;

const num = (raw: Raw, key: string): number | null => {
  const v = raw[key];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const bool = (raw: Raw, key: string): boolean | null => {
  const v = raw[key];
  return v === "true" ? true : v === "false" ? false : null;
};

function readPrices(raw: Raw): Prices | null {
  const energyC = num(raw, "energy_price_c_per_kwh");
  const energyIncludesVat = bool(raw, "energy_price_includes_vat");
  const transferC = num(raw, "transfer_price_c_per_kwh");
  const transferIncludesVat = bool(raw, "transfer_price_includes_vat");
  const taxC = num(raw, "electricity_tax_c_per_kwh");
  const taxIncludesVat = bool(raw, "electricity_tax_includes_vat");
  const vatPercent = num(raw, "vat_percent");
  if (energyC === null || energyIncludesVat === null || transferC === null || transferIncludesVat === null) return null;
  if (taxC === null || taxIncludesVat === null || vatPercent === null) return null;
  return { energyC, energyIncludesVat, transferC, transferIncludesVat, taxC, taxIncludesVat, vatPercent };
}

export function parseSettings(raw: Raw): Settings {
  return {
    homeLat: num(raw, "home_lat"),
    homeLon: num(raw, "home_lon"),
    homeRadiusM: num(raw, "home_radius_m") ?? 50,
    batteryUsableKwh: num(raw, "battery_usable_kwh") ?? 20,
    pluggedIntervalMin: num(raw, "poll_interval_plugged_min") ?? 10,
    idleIntervalMin: num(raw, "poll_interval_idle_min") ?? 15,
    maxGapMin: num(raw, "max_gap_min") ?? 45,
    sessionStaleMin: num(raw, "session_stale_min") ?? 180,
    costEnergySource: raw.cost_energy_source === "soc" ? "soc" : "power",
    prices: readPrices(raw),
  };
}

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return parseSettings(Object.fromEntries(results.map((r) => [r.key, r.value])));
}
```

**File: `src/skoda.ts`**

```ts
const BASE = "https://public.api.connect.skoda-auto.cz/api/v1/vehicles";
const TIMEOUT_MS = 20_000;

export type ParkingPosition = {
  state: string;
  gpsCoordinates?: { latitude: number; longitude: number };
};

export type VehicleResponse = {
  vehicle: {
    parkingPosition?: ParkingPosition;
    odometer?: { mileageInKm: number };
    charging?: {
      carCapturedTimestamp?: string;
      status?: {
        state?: string;
        plugConnectionState?: string;
        chargePowerInKw?: number;
        battery?: { stateOfChargeInPercent?: number };
      };
    };
  };
  errors?: { type: string }[];
};

export type RateMeta = {
  keyExpiresAt: number | null; // unix seconds
  rateRemaining: number | null;
  rateResetSeconds: number | null;
  retryAfterSeconds: number | null;
};

export type ErrorKind = "auth" | "rate_limit" | "server" | "network";

export type FetchResult =
  | { ok: true; body: VehicleResponse; meta: RateMeta }
  | { ok: false; kind: ErrorKind; status: number | null; problemType: string | null; meta: RateMeta };

const EMPTY_META: RateMeta = { keyExpiresAt: null, rateRemaining: null, rateResetSeconds: null, retryAfterSeconds: null };

function intHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

function epochHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export function readMeta(headers: Headers, nowSec: number): RateMeta {
  const retryDate = intHeader(headers, "Retry-After") === null ? epochHeader(headers, "Retry-After") : null;
  return {
    keyExpiresAt: epochHeader(headers, "X-API-Key-Expires-At"),
    rateRemaining: intHeader(headers, "RateLimit-Remaining"),
    rateResetSeconds: intHeader(headers, "RateLimit-Reset"),
    retryAfterSeconds: intHeader(headers, "Retry-After") ?? (retryDate === null ? null : Math.max(0, retryDate - nowSec)),
  };
}

function classify(status: number): ErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  return "server";
}

// Only the slug of the problem type is kept: `detail` and `instance` can carry the VIN.
async function problemSlug(res: Response): Promise<string | null> {
  try {
    const body = await res.json<{ type?: unknown }>();
    return typeof body.type === "string" ? (body.type.split("/").pop() ?? null) : null;
  } catch {
    return null;
  }
}

export async function fetchVehicle(env: Env, parts: string[], nowSec: number): Promise<FetchResult> {
  const query = parts.map((p) => `include=${p}`).join("&");
  let res: Response;
  try {
    res = await fetch(`${BASE}/${env.SKODA_VIN}?${query}`, {
      headers: { "X-API-Key": env.SKODA_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, kind: "network", status: null, problemType: null, meta: EMPTY_META };
  }
  const meta = readMeta(res.headers, nowSec);
  if (!res.ok) {
    return { ok: false, kind: classify(res.status), status: res.status, problemType: await problemSlug(res), meta };
  }
  try {
    return { ok: true, body: await res.json<VehicleResponse>(), meta };
  } catch {
    return { ok: false, kind: "server", status: res.status, problemType: "invalid-json", meta };
  }
}
```

**File: `test/skoda.test.ts`**

```ts
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVehicle, readMeta } from "../src/skoda";

afterEach(() => vi.restoreAllMocks());

const NOW = Date.parse("2026-10-21T07:28:00Z") / 1000;

describe("readMeta", () => {
  it("POLL-10 reads quota and expiry headers", () => {
    const meta = readMeta(new Headers({ "X-API-Key-Expires-At": "2026-12-01T00:00:00Z", "RateLimit-Remaining": "7", "RateLimit-Reset": "120" }), NOW);
    expect(meta).toEqual({ keyExpiresAt: Date.parse("2026-12-01T00:00:00Z") / 1000, rateRemaining: 7, rateResetSeconds: 120, retryAfterSeconds: null });
  });
  it("POLL-6 accepts Retry-After in seconds", () => expect(readMeta(new Headers({ "Retry-After": "90" }), NOW).retryAfterSeconds).toBe(90));
  it("POLL-6 accepts Retry-After as a date", () => expect(readMeta(new Headers({ "Retry-After": "Wed, 21 Oct 2026 07:28:30 GMT" }), NOW).retryAfterSeconds).toBe(30));
  it("POLL-10 ignores an unparsable expiry", () => expect(readMeta(new Headers({ "X-API-Key-Expires-At": "soon" }), NOW).keyExpiresAt).toBeNull());
});

describe("fetchVehicle", () => {
  const respond = (status: number, body: string) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status }));

  it("POLL-3 sends the key and repeated include params", async () => {
    const f = respond(200, JSON.stringify({ vehicle: {} }));
    const r = await fetchVehicle(env, ["charging", "odometer"], NOW);
    expect(r.ok).toBe(true);
    expect(String(f.mock.calls[0]?.[0])).toContain("?include=charging&include=odometer");
  });
  it("SEC-4 keeps only the problem slug", async () => {
    respond(401, JSON.stringify({ type: "https://public.api.connect.skoda-auto.cz/problems/api-key-expired", instance: "/api/v1/vehicles/SECRETVIN" }));
    const r = await fetchVehicle(env, ["charging"], NOW);
    expect(r).toMatchObject({ ok: false, kind: "auth", status: 401, problemType: "api-key-expired" });
    expect(JSON.stringify(r)).not.toContain("SECRETVIN");
  });
  it("POLL-8 classifies 403, 429 and 5xx", async () => {
    for (const [status, kind] of [[403, "auth"], [429, "rate_limit"], [503, "server"]] as const) {
      respond(status, "{}");
      expect(await fetchVehicle(env, ["charging"], NOW)).toMatchObject({ ok: false, kind });
      vi.restoreAllMocks();
    }
  });
  it("POLL-8 survives a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    expect(await fetchVehicle(env, ["charging"], NOW)).toMatchObject({ ok: false, kind: "network", status: null });
  });
  it("POLL-8 treats invalid JSON as a server error", async () => {
    respond(200, "not json");
    expect(await fetchVehicle(env, ["charging"], NOW)).toMatchObject({ ok: false, kind: "server", problemType: "invalid-json" });
  });
});
```


**Done when:** `pnpm check` passes.

**Commit:** `feat: add settings and Škoda API client`.

### Task 1.3 `[MODEL]` Poll loop

**Implements:** POLL-2, POLL-4, POLL-5, POLL-9, POLL-10, POLL-11, HOME-1, HOME-2, HOME-3, SEC-5.

`session-store.ts` is a stub for now, so `poll.ts` never has to change in Phase 2.

The helper file below is also used by every later test.

**File: `src/sample.ts`**

```ts
import { distanceM } from "./geo";
import type { Settings } from "./settings";
import type { ParkingPosition, VehicleResponse } from "./skoda";

export type Sample = {
  capturedAt: number; // unix seconds, from charging.carCapturedTimestamp
  plugState: string | null;
  chargeState: string | null;
  powerKw: number | null;
  socPercent: number | null;
  odometerKm: number | null;
  atHome: boolean | null;
};

export type PreviousPlace = { plugState: string | null; atHome: number | null };

export function resolveAtHome(parking: ParkingPosition | undefined, s: Settings, plugState: string | null, prev: PreviousPlace): boolean | null {
  const gps = parking?.gpsCoordinates;
  if (parking?.state === "PARKED" && gps !== undefined && s.homeLat !== null && s.homeLon !== null) {
    return distanceM(gps, { latitude: s.homeLat, longitude: s.homeLon }) <= s.homeRadiusM;
  }
  // A car that stayed plugged in cannot have moved.
  if (plugState === "CONNECTED" && prev.plugState === "CONNECTED" && prev.atHome !== null) {
    return prev.atHome === 1;
  }
  return null;
}

export function toSample(body: VehicleResponse, s: Settings, prev: PreviousPlace): Sample | null {
  const charging = body.vehicle.charging;
  const capturedMs = Date.parse(charging?.carCapturedTimestamp ?? "");
  if (Number.isNaN(capturedMs)) return null;
  const status = charging?.status;
  const plugState = status?.plugConnectionState ?? null;
  return {
    capturedAt: Math.floor(capturedMs / 1000),
    plugState,
    chargeState: status?.state ?? null,
    powerKw: status?.chargePowerInKw ?? null,
    socPercent: status?.battery?.stateOfChargeInPercent ?? null,
    odometerKm: body.vehicle.odometer?.mileageInKm ?? null,
    atHome: resolveAtHome(body.vehicle.parkingPosition, s, plugState, prev),
  };
}
```

**File: `src/session-store.ts`**

```ts
import type { Sample } from "./sample";
import type { Settings } from "./settings";

// Phase 2 replaces this file. Until then the collector only stores snapshots.
export async function sessionWrites(_db: D1Database, _sample: Sample | null, _nowSec: number, _s: Settings, _timeZone: string): Promise<D1PreparedStatement[]> {
  return [];
}
```

**File: `src/poll.ts`**

```ts
import { nextNotBefore, shouldPoll } from "./gate";
import { toSample } from "./sample";
import { sessionWrites } from "./session-store";
import { loadSettings } from "./settings";
import { fetchVehicle } from "./skoda";

const POLL_PARTS = ["charging", "parkingPosition", "odometer"];
const ERROR_RETENTION_SECONDS = 30 * 86400;

export type PollStateRow = {
  last_poll_at: number | null;
  last_success_at: number | null;
  not_before: number | null;
  last_captured_at: number | null;
  last_plug_state: string | null;
  last_at_home: number | null;
  key_expires_at: number | null;
  rate_limit_remaining: number | null;
  auth_failures: number;
  rate_limit_failures: number;
};

export type PollOutcome = "skipped" | "error" | "partial" | "unchanged" | "stored";

export async function loadPollState(db: D1Database): Promise<PollStateRow> {
  const row = await db.prepare("SELECT * FROM poll_state WHERE id = 1").first<PollStateRow>();
  if (row === null) throw new Error("poll_state row missing");
  return row;
}

export async function pollOnce(env: Env, nowSec: number): Promise<PollOutcome> {
  const db = env.DB;
  const state = await loadPollState(db);
  const settings = await loadSettings(db);
  const due = shouldPoll(nowSec, {
    lastPollAt: state.last_poll_at,
    notBefore: state.not_before,
    lastPlugState: state.last_plug_state,
    pluggedIntervalMin: settings.pluggedIntervalMin,
    idleIntervalMin: settings.idleIntervalMin,
  });
  if (!due) return "skipped";

  const result = await fetchVehicle(env, POLL_PARTS, nowSec);
  const { keyExpiresAt, rateRemaining, rateResetSeconds, retryAfterSeconds } = result.meta;

  if (!result.ok) {
    const authFailures = state.auth_failures + (result.kind === "auth" ? 1 : 0);
    const rateFailures = state.rate_limit_failures + (result.kind === "rate_limit" ? 1 : 0);
    const notBefore = nextNotBefore(nowSec, { failureKind: result.kind, retryAfterSeconds, rateRemaining, rateResetSeconds, authFailures });
    await db.batch([
      db.prepare("INSERT INTO poll_error (at, kind, http_status, problem_type) VALUES (?, ?, ?, ?)").bind(nowSec, result.kind, result.status, result.problemType),
      db.prepare("DELETE FROM poll_error WHERE at < ?").bind(nowSec - ERROR_RETENTION_SECONDS),
      db
        .prepare(
          `UPDATE poll_state SET last_poll_at = ?, not_before = ?, auth_failures = ?, rate_limit_failures = ?,
           key_expires_at = COALESCE(?, key_expires_at), rate_limit_remaining = COALESCE(?, rate_limit_remaining) WHERE id = 1`,
        )
        .bind(nowSec, notBefore, authFailures, rateFailures, keyExpiresAt, rateRemaining),
    ]);
    return "error";
  }

  const sample = toSample(result.body, settings, { plugState: state.last_plug_state, atHome: state.last_at_home });
  const isNew = sample !== null && (state.last_captured_at === null || sample.capturedAt > state.last_captured_at);
  const atHome = sample?.atHome == null ? null : Number(sample.atHome);
  const notBefore = nextNotBefore(nowSec, { failureKind: null, retryAfterSeconds, rateRemaining, rateResetSeconds, authFailures: 0 });
  const writes: D1PreparedStatement[] = [];

  if (sample === null) {
    const kinds = (result.body.errors ?? []).map((e) => e.type).join(",") || "missing-charging";
    writes.push(db.prepare("INSERT INTO poll_error (at, kind, http_status, problem_type) VALUES (?, 'partial', 200, ?)").bind(nowSec, kinds.slice(0, 200)));
  }
  if (sample !== null && isNew) {
    writes.push(
      db
        .prepare("INSERT OR IGNORE INTO snapshot (captured_at, plug_state, charge_state, charge_power_kw, soc_percent, odometer_km, at_home) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(sample.capturedAt, sample.plugState, sample.chargeState, sample.powerKw, sample.socPercent, sample.odometerKm, atHome),
    );
  }
  writes.push(
    db
      .prepare(
        `UPDATE poll_state SET last_poll_at = ?, last_success_at = ?, not_before = ?, auth_failures = 0, rate_limit_failures = 0,
         key_expires_at = COALESCE(?, key_expires_at), rate_limit_remaining = COALESCE(?, rate_limit_remaining),
         last_captured_at = COALESCE(?, last_captured_at), last_plug_state = COALESCE(?, last_plug_state), last_at_home = COALESCE(?, last_at_home) WHERE id = 1`,
      )
      .bind(nowSec, nowSec, notBefore, keyExpiresAt, rateRemaining, isNew ? sample.capturedAt : null, sample?.plugState ?? null, atHome),
    ...(await sessionWrites(db, isNew ? sample : null, nowSec, settings, env.TIMEZONE)),
  );
  await db.batch(writes);
  if (sample === null) return "partial";
  return isNew ? "stored" : "unchanged";
}
```

**File: `test/helpers.ts`**

```ts
import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { vi } from "vitest";

export const HOME = { latitude: 60.17, longitude: 24.94 };
export const AWAY = { latitude: 61, longitude: 25 };
export const T0 = Date.parse("2026-10-31T21:50:00Z") / 1000;

// D1 data persists across tests in a file, so every test starts from this.
export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM snapshot"),
    env.DB.prepare("DELETE FROM charge_session"),
    env.DB.prepare("DELETE FROM poll_error"),
    env.DB.prepare("DELETE FROM alert_log"),
    env.DB.prepare("DELETE FROM poll_state"),
    env.DB.prepare("INSERT INTO poll_state (id) VALUES (1)"),
    env.DB.prepare(
      "DELETE FROM settings WHERE key IN ('home_lat', 'home_lon', 'vat_percent', 'energy_price_includes_vat', 'transfer_price_includes_vat', 'electricity_tax_includes_vat')",
    ),
    env.DB.prepare("UPDATE settings SET value = '8' WHERE key = 'energy_price_c_per_kwh'"),
  ]);
}

export async function setHomeAndPrices(): Promise<void> {
  const put = (key: string, value: string) => env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(key, value);
  await env.DB.batch([
    put("home_lat", String(HOME.latitude)),
    put("home_lon", String(HOME.longitude)),
    put("vat_percent", "25"),
    put("energy_price_includes_vat", "false"),
    put("transfer_price_includes_vat", "true"),
    put("electricity_tax_includes_vat", "true"),
  ]);
}

export type BodyOptions = { ts: string; state?: string; plug?: string; kw?: number; soc?: number; parking?: unknown };

export function vehicleBody(o: BodyOptions) {
  return {
    vehicle: {
      parkingPosition: o.parking ?? { state: "PARKED", gpsCoordinates: HOME },
      odometer: { mileageInKm: 1000 },
      charging: {
        isVehicleInSavedLocation: false,
        carCapturedTimestamp: o.ts,
        status: {
          state: o.state,
          plugConnectionState: o.plug ?? "CONNECTED",
          chargePowerInKw: o.kw ?? 0,
          battery: { stateOfChargeInPercent: o.soc ?? 20 },
        },
      },
    },
    errors: [],
  };
}

export function apiResponse(body: unknown, init?: ResponseInit): Response {
  const headers = { "RateLimit-Remaining": "15", "RateLimit-Reset": "1800", "X-API-Key-Expires-At": "2026-12-01T00:00:00Z" };
  return new Response(JSON.stringify(body), { headers, ...init });
}

// Serves the bodies in order, one per poll.
export function mockApiSequence(bodies: unknown[]) {
  const queue = [...bodies];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => apiResponse(queue.shift()));
}

const keys = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };

export function mintToken(audience: string = env.ACCESS_AUD): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(env.ACCESS_TEAM_DOMAIN)
    .setAudience(audience)
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

// Answers the Access JWKS lookup and passes every other request to `other`.
export function mockFetch(other: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).endsWith("/cdn-cgi/access/certs")) {
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
    }
    return other();
  });
}

export async function authedHeaders(): Promise<Record<string, string>> {
  return { "Cf-Access-Jwt-Assertion": await mintToken(), "content-type": "application/json" };
}
```

**File: `test/poll.test.ts`**

```ts
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollOnce } from "../src/poll";
import { AWAY, T0, apiResponse, mockApiSequence, resetDb, setHomeAndPrices, vehicleBody } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

describe("pollOnce", () => {
  it("POLL-4 stores one snapshot per car timestamp", async () => {
    await setHomeAndPrices();
    mockApiSequence([
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "READY_FOR_CHARGING" }),
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "READY_FOR_CHARGING" }),
      vehicleBody({ ts: "2026-10-31T22:10Z", state: "CHARGING", kw: 3.6, soc: 21 }),
    ]);
    expect(await pollOnce(env, T0)).toBe("stored");
    expect(await pollOnce(env, T0 + 900)).toBe("unchanged");
    expect(await pollOnce(env, T0 + 1800)).toBe("stored");
    expect(await count("snapshot")).toBe(2);
    const row = await env.DB.prepare("SELECT * FROM snapshot ORDER BY captured_at DESC").first();
    expect(row).toEqual({
      captured_at: Date.parse("2026-10-31T22:10:00Z") / 1000,
      plug_state: "CONNECTED",
      charge_state: "CHARGING",
      charge_power_kw: 3.6,
      soc_percent: 21,
      odometer_km: 1000,
      at_home: 1,
    });
  });
  it("POLL-2 does not call the API when the gate is closed", async () => {
    await env.DB.prepare("UPDATE poll_state SET last_poll_at = ?").bind(T0).run();
    const f = vi.spyOn(globalThis, "fetch");
    expect(await pollOnce(env, T0 + 300)).toBe("skipped");
    expect(f).not.toHaveBeenCalled();
  });
  it("POLL-6 POLL-8 honours Retry-After and logs a 429", async () => {
    const body = { type: "https://public.api.connect.skoda-auto.cz/problems/rate-limit-exceeded" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 429, headers: { "Retry-After": "600" } }));
    expect(await pollOnce(env, T0)).toBe("error");
    const state = await env.DB.prepare("SELECT not_before, rate_limit_failures FROM poll_state").first();
    expect(state).toEqual({ not_before: T0 + 600, rate_limit_failures: 1 });
    expect(await env.DB.prepare("SELECT kind, problem_type FROM poll_error").first()).toEqual({ kind: "rate_limit", problem_type: "rate-limit-exceeded" });
    expect(await pollOnce(env, T0 + 599)).toBe("skipped");
  });
  it("POLL-9 clears failure counters after a success", async () => {
    await env.DB.prepare("UPDATE poll_state SET auth_failures = 2, rate_limit_failures = 2").run();
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z" })]);
    await pollOnce(env, T0);
    expect(await env.DB.prepare("SELECT auth_failures, rate_limit_failures FROM poll_state").first()).toEqual({ auth_failures: 0, rate_limit_failures: 0 });
  });
  it("POLL-10 records key expiry and quota", async () => {
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z" })]);
    await pollOnce(env, T0);
    const state = await env.DB.prepare("SELECT key_expires_at, rate_limit_remaining FROM poll_state").first();
    expect(state).toEqual({ key_expires_at: Date.parse("2026-12-01T00:00:00Z") / 1000, rate_limit_remaining: 15 });
  });
  it("POLL-5 logs a partial 200 without storing a snapshot", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiResponse({ vehicle: {}, errors: [{ type: "CHARGING_UNAVAILABLE" }] }));
    expect(await pollOnce(env, T0)).toBe("partial");
    expect(await env.DB.prepare("SELECT kind, problem_type FROM poll_error").first()).toEqual({ kind: "partial", problem_type: "CHARGING_UNAVAILABLE" });
    expect(await count("snapshot")).toBe(0);
  });
  it("HOME-1 HOME-2 stores at_home 0 away and NULL before home is set", async () => {
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z" })]);
    await pollOnce(env, T0);
    expect(await env.DB.prepare("SELECT at_home FROM snapshot").first()).toEqual({ at_home: null });
    await setHomeAndPrices();
    vi.restoreAllMocks();
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:30Z", plug: "DISCONNECTED", parking: { state: "PARKED", gpsCoordinates: AWAY } })]);
    await pollOnce(env, T0 + 1800);
    expect(await env.DB.prepare("SELECT at_home FROM snapshot ORDER BY captured_at DESC").first()).toEqual({ at_home: 0 });
  });
  it("HOME-3 carries at_home over while the car stays plugged in", async () => {
    await setHomeAndPrices();
    mockApiSequence([
      vehicleBody({ ts: "2026-10-31T22:00Z" }),
      vehicleBody({ ts: "2026-10-31T22:10Z", parking: { state: "IN_MOTION" } }),
    ]);
    await pollOnce(env, T0);
    await pollOnce(env, T0 + 600);
    expect(await env.DB.prepare("SELECT at_home FROM snapshot ORDER BY captured_at DESC").first()).toEqual({ at_home: 1 });
  });
  it("POLL-11 deletes logged errors after 30 days", async () => {
    await env.DB.prepare("INSERT INTO poll_error (at, kind) VALUES (?, 'server')").bind(T0 - 31 * 86400).run();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    await pollOnce(env, T0);
    expect(await env.DB.prepare("SELECT at FROM poll_error").all().then((r) => r.results)).toEqual([{ at: T0 }]);
  });
  it("SEC-5 never stores GPS coordinates", async () => {
    await setHomeAndPrices();
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z" })]);
    await pollOnce(env, T0);
    const row = await env.DB.prepare("SELECT * FROM snapshot").first();
    expect(Object.keys(row ?? {})).not.toContain("latitude");
    expect(JSON.stringify(row)).not.toContain("60.17");
  });
});
```


What one poll does:

1. Read `poll_state` and settings. If the gate is closed, stop. No API call is made.
2. Call the API. On failure, log to `poll_error`, count the failure, set `not_before` if needed, and stop.
3. Turn the response into a `Sample`. If `charging` is missing, log a `partial` error.
4. If the car's timestamp is newer than the last one, insert a snapshot.
5. Update `poll_state`, and apply any session change, in one `db.batch`.

**Done when:** `pnpm check` passes.

**Commit:** `feat: add polling loop and snapshot storage`.

### Task 1.4 `[MODEL]` Access check and first routes

**Implements:** API-1, API-2, API-3, HOME-4, SEC-1, SEC-2, SEC-3, SEC-5.

**File: `src/auth.ts`**

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksFor: string | null = null;

export const requireAccess: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = c.env;
  if (c.env.DEV_AUTH_BYPASS === "1" && new URL(c.req.url).hostname === "localhost") return next();
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!team || !aud || !token) return c.json({ error: "forbidden" }, 403);
  if (jwks === null || jwksFor !== team) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwksFor = team;
  }
  try {
    await jwtVerify(token, jwks, { issuer: team, audience: aud, algorithms: ["RS256"] });
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
};
```

**File: `src/routes.ts`**

```ts
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { requireAccess } from "./auth";
import { loadPollState } from "./poll";
import { loadSettings } from "./settings";
import { fetchVehicle } from "./skoda";

export type AppEnv = { Bindings: Env };

const number = (min: number, max: number) => (v: unknown) => (typeof v === "number" && v >= min && v <= max ? String(v) : null);
const boolean = (v: unknown) => (typeof v === "boolean" ? String(v) : null);
const source = (v: unknown) => (v === "power" || v === "soc" ? v : null);

const EDITABLE: Record<string, (v: unknown) => string | null> = {
  energy_price_c_per_kwh: number(0, 200),
  energy_price_includes_vat: boolean,
  transfer_price_c_per_kwh: number(0, 200),
  transfer_price_includes_vat: boolean,
  electricity_tax_c_per_kwh: number(0, 200),
  electricity_tax_includes_vat: boolean,
  vat_percent: number(0, 100),
  battery_usable_kwh: number(1, 100),
  home_radius_m: number(10, 1000),
  poll_interval_plugged_min: number(5, 60),
  poll_interval_idle_min: number(5, 120),
  max_gap_min: number(5, 240),
  session_stale_min: number(30, 1440),
  cost_energy_source: source,
};

export const app = new Hono<AppEnv>();

app.use("/api/*", csrf(), requireAccess);
app.use("/setup/*", csrf(), requireAccess);

app.get("/api/health", async (c) => {
  const st = await loadPollState(c.env.DB);
  const { results } = await c.env.DB.prepare("SELECT at, kind, http_status, problem_type FROM poll_error ORDER BY at DESC LIMIT 10").all();
  const open = await c.env.DB.prepare("SELECT started_at, kwh_by_power, start_soc, end_soc FROM charge_session WHERE status = 'open'").first();
  return c.json({
    last_poll_at: st.last_poll_at,
    last_success_at: st.last_success_at,
    last_captured_at: st.last_captured_at,
    not_before: st.not_before,
    key_expires_at: st.key_expires_at,
    rate_limit_remaining: st.rate_limit_remaining,
    open_session: open,
    errors: results,
  });
});

app.get("/api/settings", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const raw = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const values = Object.fromEntries(Object.keys(EDITABLE).map((k) => [k, raw[k] ?? null]));
  const settings = await loadSettings(c.env.DB);
  return c.json({ values, home_set: settings.homeLat !== null, prices_complete: settings.prices !== null });
});

app.put("/api/settings", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (body === null || typeof body !== "object") return c.json({ error: "JSON object required" }, 400);
  const writes: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(body)) {
    const encoded = EDITABLE[key]?.(value) ?? null;
    if (encoded === null) return c.json({ error: `invalid value for ${key}` }, 400);
    writes.push(c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(key, encoded));
  }
  if (writes.length > 0) await c.env.DB.batch(writes);
  return c.json({ updated: writes.length });
});

app.post("/setup/home", async (c) => {
  const settings = await loadSettings(c.env.DB);
  if (settings.homeLat !== null && c.req.query("force") !== "1") return c.json({ error: "home already set; pass force=1 to replace it" }, 409);
  const result = await fetchVehicle(c.env, ["parkingPosition"], Math.floor(Date.now() / 1000));
  if (!result.ok) return c.json({ error: `Škoda API error: ${result.kind}` }, 502);
  const parking = result.body.vehicle.parkingPosition;
  if (parking?.state !== "PARKED" || parking.gpsCoordinates === undefined) return c.json({ error: "car is not reporting a parked position" }, 409);
  const { latitude, longitude } = parking.gpsCoordinates;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('home_lat', ?)").bind(String(latitude)),
    c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('home_lon', ?)").bind(String(longitude)),
  ]);
  return c.json({ home_set: true });
});
```

**File: `src/index.ts`**

```ts
import { pollOnce } from "./poll";
import { app } from "./routes";

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(pollOnce(env, Math.floor(Date.now() / 1000)));
  },
} satisfies ExportedHandler<Env>;
```

**File: `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PHEV Cost Tracker</title>
</head>
<body>
  <h1>PHEV Cost Tracker setup</h1>
  <p><button id="home">Capture home position</button></p>
  <pre id="out"></pre>
  <script>
    const out = document.getElementById("out");
    const show = async (res) => { out.textContent = JSON.stringify(await res.json(), null, 2); };
    document.getElementById("home").onclick = async () => {
      show(await fetch("/setup/home", { method: "POST", headers: { "Content-Type": "application/json" } }));
    };
    fetch("/api/health").then(show);
  </script>
</body>
</html>
```

**File: `test/routes.test.ts`**

```ts
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/routes";
import { loadSettings } from "../src/settings";
import { HOME, apiResponse, authedHeaders, mintToken, mockFetch, resetDb } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const get = (path: string, headers?: Record<string, string>) => exports.default.fetch(`https://x${path}`, { headers });
const send = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  exports.default.fetch(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

describe("SEC-1 access", () => {
  it("rejects a request with no token", async () => expect((await get("/api/health")).status).toBe(403));
  it("rejects the wrong audience", async () => {
    mockFetch(() => new Response("{}"));
    expect((await get("/api/health", { "Cf-Access-Jwt-Assertion": await mintToken("other") })).status).toBe(403);
  });
  it("accepts a valid token", async () => {
    mockFetch(() => new Response("{}"));
    expect((await get("/api/health", await authedHeaders())).status).toBe(200);
  });
  it("protects setup", async () => expect((await send("POST", "/setup/home", {})).status).toBe(403));
  it("rejects everything when Access settings are missing", async () => {
    mockFetch(() => new Response("{}"));
    const res = await app.request("https://x/api/health", { headers: await authedHeaders() }, { ...env, ACCESS_AUD: "" });
    expect(res.status).toBe(403);
  });
});

describe("SEC-3 dev bypass", () => {
  const bypass = { ...env, DEV_AUTH_BYPASS: "1" };

  it("works on localhost", async () => expect((await app.request("http://localhost:8787/api/health", {}, bypass)).status).toBe(200));
  it("does not work on any other host", async () => expect((await app.request("https://x/api/health", {}, bypass)).status).toBe(403));
  it("does not work on 127.0.0.1", async () => expect((await app.request("http://127.0.0.1:8787/api/health", {}, bypass)).status).toBe(403));
});

describe("API-1 health", () => {
  it("returns the health fields", async () => {
    mockFetch(() => new Response("{}"));
    await env.DB.prepare("INSERT INTO poll_error (at, kind, http_status, problem_type) VALUES (5, 'auth', 401, 'api-key-expired')").run();
    const body = await (await get("/api/health", await authedHeaders())).json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(["errors", "key_expires_at", "last_captured_at", "last_poll_at", "last_success_at", "not_before", "open_session", "rate_limit_remaining"]);
    expect(body.errors).toEqual([{ at: 5, kind: "auth", http_status: 401, problem_type: "api-key-expired" }]);
  });
});

describe("API-2 API-3 settings", () => {
  it("changes nothing when one value is invalid", async () => {
    mockFetch(() => new Response("{}"));
    const h = await authedHeaders();
    expect((await send("PUT", "/api/settings", h, { vat_percent: 25, home_lat: 1 })).status).toBe(400);
    const got = await (await get("/api/settings", h)).json<{ values: Record<string, string | null> }>();
    expect(got.values.vat_percent).toBeNull();
  });
  it("updates allowed keys and rejects bad values", async () => {
    mockFetch(() => new Response("{}"));
    const h = await authedHeaders();
    expect((await send("PUT", "/api/settings", h, { vat_percent: 25.5, energy_price_includes_vat: true })).status).toBe(200);
    expect((await send("PUT", "/api/settings", h, { vat_percent: "x" })).status).toBe(400);
    expect((await send("PUT", "/api/settings", h, { home_lat: 1 })).status).toBe(400);
    const got = await (await get("/api/settings", h)).json<{ values: Record<string, string | null>; home_set: boolean; prices_complete: boolean }>();
    expect(got.values.vat_percent).toBe("25.5");
    expect(got.home_set).toBe(false);
    expect(got.prices_complete).toBe(false);
    expect(JSON.stringify(got)).not.toContain("home_lat");
  });
});

describe("HOME-4 POST /setup/home", () => {
  const parked = () => apiResponse({ vehicle: { parkingPosition: { state: "PARKED", gpsCoordinates: HOME } } });

  it("SEC-5 stores the position once and never returns it", async () => {
    mockFetch(parked);
    const h = await authedHeaders();
    const res = await send("POST", "/setup/home", h);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("60.17");
    expect((await loadSettings(env.DB)).homeLat).toBe(HOME.latitude);
    expect((await send("POST", "/setup/home", h)).status).toBe(409);
    expect((await send("POST", "/setup/home?force=1", h)).status).toBe(200);
  });
  it("refuses when the car is moving", async () => {
    mockFetch(() => apiResponse({ vehicle: { parkingPosition: { state: "IN_MOTION" } } }));
    expect((await send("POST", "/setup/home", await authedHeaders())).status).toBe(409);
  });
  it("SEC-2 needs a JSON content type", async () => {
    mockFetch(parked);
    const { "content-type": _dropped, ...h } = await authedHeaders();
    expect((await send("POST", "/setup/home", h)).status).toBe(403);
  });
});
```


Notes:

- `run_worker_first` in `wrangler.jsonc` sends `/api/*` and `/setup/*` through the Worker. Everything else is a static file, which holds no data.
- `DEV_AUTH_BYPASS` only works when the host is exactly `localhost`, and it is never set on the deployed Worker.
- Hono's `csrf()` treats a POST with no `Content-Type` as a form and returns 403. Always send `Content-Type: application/json`.

Check it locally:

```bash
pnpm migrate:local
pnpm dev
```

In a second terminal:

```bash
curl -s http://localhost:8787/api/health
```

Expect JSON with `"last_poll_at":null`. Stop the dev server. Do not trigger the scheduled handler here: it would call the real Škoda API with the placeholder key.

**Done when:** `pnpm check` and `pnpm check:specs 1` pass, and the local health check returns JSON.

**Commit:** `feat: add Access check, health, settings and home setup routes`.

### Task 1.5 `[HUMAN]` First deployment

**Verifies:** SEC-6, SEC-7.

1. Log in and create the database:

   ```bash
   pnpm exec wrangler login
   pnpm exec wrangler d1 create phev-cost-tracker
   ```

2. Put the printed `database_id` into `wrangler.jsonc`.
3. Apply the schema to the remote database:

   ```bash
   pnpm migrate:remote
   ```

4. Add the secrets. Paste each value at the prompt, not on the command line. If Wrangler offers to create the Worker, accept:

   ```bash
   pnpm exec wrangler secret put SKODA_API_KEY
   pnpm exec wrangler secret put SKODA_VIN
   ```

5. Deploy:

   ```bash
   pnpm deploy
   ```

6. Set up Access in the Cloudflare dashboard. Zero Trust must be enabled on the account first.
   1. Go to **Workers & Pages**, then select `phev-cost-tracker`.
   2. Open the **Access** tab and select **Protect this Worker behind Access**.
   3. Choose **All traffic**.
   4. Under **Authentication policy**, allow only your own email address.
   5. Select **Apply Access**.
7. In **Zero Trust**, open **Access** then **Applications** and find this app. Copy its Application Audience (AUD) tag. Also note your team domain, which looks like `https://<team>.cloudflareaccess.com`. Dashboard labels may differ slightly.
8. Put both values into `vars` in `wrangler.jsonc`, then run `pnpm deploy` again. These values and the `database_id` are identifiers, not secrets, but they will be visible in the public repository.
9. Open the Worker's URL in a private browser window. You must get the Access login page.
10. After logging in, with the car parked at home, select **Capture home position**. Expect `{"home_set":true}`.

**Done when:** the login page appears, `home_set` is true, and `/api/health` shows `last_success_at` set within 20 minutes.

**Commit:** `chore: configure deployment`. Stage `wrangler.jsonc`.

### Task 1.6 `[HUMAN]` Collect real data

Let it run through at least three real home charges. Then check the data:

```bash
pnpm exec wrangler d1 execute phev-cost-tracker --remote --command "SELECT datetime(captured_at,'unixepoch') AS t, plug_state, charge_state, charge_power_kw, soc_percent, at_home FROM snapshot ORDER BY captured_at DESC LIMIT 60"
```

Write down the answers. Phase 2 settings depend on them:

| Question | If the answer is... | Then |
|---|---|---|
| Is `at_home` 1 during home charges? | No | Stop. Check the home position and `home_radius_m` |
| How far apart are snapshots while charging? | More than 45 minutes | Raise `max_gap_min` above the largest normal gap |
| Does the car go quiet for hours during a charge? | Yes | Raise `session_stale_min` |
| What is `charge_state` right after a charge ends? | Not listed in SES-3 | Stop and ask the user. SES-3 must change first |
| Are there `CHARGING_INTERRUPTED` pauses? | Often | Each pause splits a session. This is harmless, so note it only |

Also open the Worker's **Metrics** tab and check CPU time. Anything near 10 ms means stopping to look at [Troubleshooting](#troubleshooting).

**Done when:** the table is filled in and the user has confirmed the settings to use.

---

## Phase 2: Sessions and cost

Read [sessions.md](specs/sessions.md) and [cost.md](specs/cost.md) before starting this phase.

### Task 2.1 `[MODEL]` State machine

**Implements:** SES-1 to SES-9.

**File: `src/session.ts`**

```ts
import type { Sample } from "./sample";

export type OpenSession = {
  startedAt: number;
  startSoc: number | null;
  endSoc: number | null;
  lastSampleAt: number;
  lastPowerKw: number | null;
  kwhByPower: number;
  gapCount: number;
};

export type EndReason = "unplugged" | "charge_ended" | "stale";

export type Transition =
  | { kind: "none" }
  | { kind: "open"; session: OpenSession }
  | { kind: "update"; session: OpenSession }
  | { kind: "close"; session: OpenSession; endedAt: number; reason: EndReason };

// Any other value, including an omitted state or one Škoda adds later, keeps the session open.
const CLOSING_STATES = new Set(["CONNECT_CABLE", "CONSERVING", "READY_FOR_CHARGING", "DISCHARGING", "CHARGING_INTERRUPTED"]);

function highestSoc(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function advance(open: OpenSession, at: number, powerKw: number | null, soc: number | null, maxGapSeconds: number): OpenSession {
  const dt = at - open.lastSampleAt;
  let kwhByPower = open.kwhByPower;
  let gapCount = open.gapCount;
  if (dt > maxGapSeconds || open.lastPowerKw === null || powerKw === null) {
    gapCount += 1;
  } else {
    kwhByPower += ((open.lastPowerKw + powerKw) / 2) * (dt / 3600);
  }
  return {
    ...open,
    startSoc: open.startSoc ?? soc,
    endSoc: highestSoc(open.endSoc, soc),
    lastSampleAt: at,
    lastPowerKw: powerKw,
    kwhByPower,
    gapCount,
  };
}

export function step(open: OpenSession | null, s: Sample, maxGapSeconds: number): Transition {
  if (open === null) {
    if (s.plugState !== "CONNECTED" || s.chargeState !== "CHARGING" || s.atHome !== true) return { kind: "none" };
    return {
      kind: "open",
      session: {
        startedAt: s.capturedAt,
        startSoc: s.socPercent,
        endSoc: s.socPercent,
        lastSampleAt: s.capturedAt,
        lastPowerKw: s.powerKw,
        kwhByPower: 0,
        gapCount: 0,
      },
    };
  }
  if (s.capturedAt <= open.lastSampleAt) return { kind: "none" };

  const unplugged = s.plugState === "DISCONNECTED";
  const ended = s.chargeState !== null && CLOSING_STATES.has(s.chargeState);
  if (unplugged || ended) {
    return {
      kind: "close",
      session: advance(open, s.capturedAt, 0, s.socPercent, maxGapSeconds),
      endedAt: s.capturedAt,
      reason: unplugged ? "unplugged" : "charge_ended",
    };
  }
  return { kind: "update", session: advance(open, s.capturedAt, s.powerKw, s.socPercent, maxGapSeconds) };
}

export function closeIfStale(open: OpenSession, nowSec: number, staleSeconds: number): Transition {
  if (nowSec - open.lastSampleAt <= staleSeconds) return { kind: "none" };
  return { kind: "close", session: open, endedAt: open.lastSampleAt, reason: "stale" };
}
```

**File: `test/session.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { closeIfStale, step, type OpenSession } from "../src/session";
import type { Sample } from "../src/sample";

const GAP = 45 * 60;
const sample = (over: Partial<Sample>): Sample => ({
  capturedAt: 0,
  plugState: "CONNECTED",
  chargeState: "CHARGING",
  powerKw: 3.6,
  socPercent: 20,
  odometerKm: null,
  atHome: true,
  ...over,
});
const open: OpenSession = { startedAt: 0, startSoc: 20, endSoc: 20, lastSampleAt: 0, lastPowerKw: 3.6, kwhByPower: 0, gapCount: 0 };

function closeOf(t: ReturnType<typeof step>) {
  if (t.kind !== "close") throw new Error(`expected close, got ${t.kind}`);
  return t;
}
function updateOf(t: ReturnType<typeof step>) {
  if (t.kind !== "update") throw new Error(`expected update, got ${t.kind}`);
  return t.session;
}

describe("SES-1 opening", () => {
  it("opens when plugged in, charging and at home", () => expect(step(null, sample({}), GAP).kind).toBe("open"));
  it.each([
    [{ atHome: false }],
    [{ atHome: null }],
    [{ chargeState: null }],
    [{ plugState: "DISCONNECTED" }],
    [{ chargeState: "READY_FOR_CHARGING" }],
  ])("stays closed for %j", (over) => expect(step(null, sample(over), GAP).kind).toBe("none"));
});

describe("energy", () => {
  it("SES-7 integrates power over time", () => {
    const s = updateOf(step(open, sample({ capturedAt: 600, socPercent: 23 }), GAP));
    expect(s.kwhByPower).toBeCloseTo(0.6, 6);
    expect(s.endSoc).toBe(23);
  });
  it("SES-7 uses the trapezoid rule", () => {
    expect(updateOf(step(open, sample({ capturedAt: 600, powerKw: 1.8 }), GAP)).kwhByPower).toBeCloseTo(0.45, 6);
  });
  it("SES-3 SES-7 ramps the closing interval to zero", () => {
    const t = closeOf(step(open, sample({ capturedAt: 600, chargeState: "READY_FOR_CHARGING", powerKw: 0 }), GAP));
    expect(t.session.kwhByPower).toBeCloseTo(0.3, 6);
    expect(t.reason).toBe("charge_ended");
  });
  it("SES-8 counts a long interval as a gap", () => {
    const s = updateOf(step(open, sample({ capturedAt: GAP + 1 }), GAP));
    expect(s.gapCount).toBe(1);
    expect(s.kwhByPower).toBe(0);
  });
  it("SES-8 counts a missing power reading as a gap", () => {
    expect(updateOf(step(open, sample({ capturedAt: 600, powerKw: null }), GAP)).gapCount).toBe(1);
  });
  it("SES-9 fills a missing start SoC from the first reading", () => {
    expect(updateOf(step({ ...open, startSoc: null, endSoc: null }, sample({ capturedAt: 600, socPercent: 25 }), GAP)).startSoc).toBe(25);
  });
});

describe("closing", () => {
  it.each(["CONNECT_CABLE", "CONSERVING", "READY_FOR_CHARGING", "DISCHARGING", "CHARGING_INTERRUPTED"])("SES-3 closes on %s", (chargeState) => {
    expect(step(open, sample({ capturedAt: 600, chargeState }), GAP).kind).toBe("close");
  });
  it("SES-4 holds on an omitted state", () => expect(step(open, sample({ capturedAt: 600, chargeState: null }), GAP).kind).toBe("update"));
  it("SES-4 holds on a state it does not recognise", () => expect(step(open, sample({ capturedAt: 600, chargeState: "NEW_VALUE" }), GAP).kind).toBe("update"));
  it("SES-2 SES-9 closes on unplug and keeps the highest SoC", () => {
    const t = closeOf(step({ ...open, endSoc: 80 }, sample({ capturedAt: 600, plugState: "DISCONNECTED", chargeState: "CONNECT_CABLE", socPercent: 75 }), GAP));
    expect(t.session.endSoc).toBe(80);
    expect(t.reason).toBe("unplugged");
  });
  it("SES-6 ignores samples that are not newer", () => expect(step({ ...open, lastSampleAt: 600 }, sample({ capturedAt: 600 }), GAP).kind).toBe("none"));
});

describe("SES-5 closeIfStale", () => {
  it("leaves a recent session open", () => expect(closeIfStale(open, 100, 180).kind).toBe("none"));
  it("closes at the last sample", () => {
    const t = closeOf(closeIfStale(open, 181, 180));
    expect(t.endedAt).toBe(0);
    expect(t.reason).toBe("stale");
  });
});
```


**Done when:** `pnpm check` passes.

**Commit:** `feat: add charge session state machine`.

### Task 2.2 `[MODEL]` Session storage

**Implements:** SES-10, COST-3, and SES-1 and SES-5 end to end.

Replace the stub with the full file.

**File: `src/session-store.ts`**

```ts
import { chooseEnergy, kwhBySoc, sessionCost, type Cost, type EnergySource } from "./cost";
import type { Sample } from "./sample";
import { closeIfStale, step, type EndReason, type OpenSession, type Transition } from "./session";
import type { Settings } from "./settings";

export type SessionRow = {
  id: number;
  started_at: number;
  start_soc: number | null;
  end_soc: number | null;
  last_sample_at: number;
  last_power_kw: number | null;
  kwh_by_power: number;
  gap_count: number;
};

export const fromRow = (r: SessionRow): OpenSession => ({
  startedAt: r.started_at,
  startSoc: r.start_soc,
  endSoc: r.end_soc,
  lastSampleAt: r.last_sample_at,
  lastPowerKw: r.last_power_kw,
  kwhByPower: r.kwh_by_power,
  gapCount: r.gap_count,
});

export function localMonth(epochSec: number, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit" }).format(new Date(epochSec * 1000));
}

export type Totals = { bySoc: number | null; kwh: number | null; source: EnergySource | null; cost: Cost | null };

export function totalsFor(kwhByPower: number, gapCount: number, startSoc: number | null, endSoc: number | null, s: Settings): Totals {
  const bySoc = kwhBySoc(startSoc, endSoc, s.batteryUsableKwh);
  const choice = chooseEnergy(kwhByPower, gapCount, bySoc, s.costEnergySource);
  const cost = choice !== null && s.prices !== null ? sessionCost(choice.kwh, s.prices) : null;
  return { bySoc, kwh: choice?.kwh ?? null, source: choice?.source ?? null, cost };
}

function closeValues(o: OpenSession, s: Settings): (number | string | null)[] {
  const t = totalsFor(o.kwhByPower, o.gapCount, o.startSoc, o.endSoc, s);
  return [o.startSoc, o.endSoc, o.lastSampleAt, o.lastPowerKw, o.kwhByPower, o.gapCount, t.bySoc, t.kwh, t.source, t.cost?.energyC ?? null, t.cost?.transferC ?? null, t.cost?.taxC ?? null, t.cost?.totalC ?? null];
}

export function insertClosed(db: D1Database, o: OpenSession, endedAt: number, reason: EndReason, s: Settings, timeZone: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO charge_session (status, started_at, ended_at, end_reason, local_month, start_soc, end_soc, last_sample_at, last_power_kw,
       kwh_by_power, gap_count, kwh_by_soc, kwh_used, kwh_source, cost_energy_c, cost_transfer_c, cost_tax_c, cost_total_c)
       VALUES ('closed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(o.startedAt, endedAt, reason, localMonth(o.startedAt, timeZone), ...closeValues(o, s));
}

function transitionStatement(db: D1Database, t: Transition, rowId: number | null, s: Settings, timeZone: string): D1PreparedStatement | null {
  if (t.kind === "none") return null;
  const o = t.session;
  if (t.kind === "open") {
    return db
      .prepare("INSERT INTO charge_session (status, started_at, local_month, start_soc, end_soc, last_sample_at, last_power_kw) VALUES ('open', ?, ?, ?, ?, ?, ?)")
      .bind(o.startedAt, localMonth(o.startedAt, timeZone), o.startSoc, o.endSoc, o.lastSampleAt, o.lastPowerKw);
  }
  if (t.kind === "update") {
    return db
      .prepare("UPDATE charge_session SET start_soc = ?, end_soc = ?, last_sample_at = ?, last_power_kw = ?, kwh_by_power = ?, gap_count = ? WHERE id = ?")
      .bind(o.startSoc, o.endSoc, o.lastSampleAt, o.lastPowerKw, o.kwhByPower, o.gapCount, rowId);
  }
  return db
    .prepare(
      `UPDATE charge_session SET status = 'closed', ended_at = ?, end_reason = ?, start_soc = ?, end_soc = ?, last_sample_at = ?, last_power_kw = ?,
       kwh_by_power = ?, gap_count = ?, kwh_by_soc = ?, kwh_used = ?, kwh_source = ?,
       cost_energy_c = ?, cost_transfer_c = ?, cost_tax_c = ?, cost_total_c = ? WHERE id = ?`,
    )
    .bind(t.endedAt, t.reason, ...closeValues(o, s), rowId);
}

// `sample` is null when the car sent nothing new: then only a stale session can change.
export async function sessionWrites(db: D1Database, sample: Sample | null, nowSec: number, s: Settings, timeZone: string): Promise<D1PreparedStatement[]> {
  const row = await db.prepare("SELECT * FROM charge_session WHERE status = 'open'").first<SessionRow>();
  const open = row === null ? null : fromRow(row);
  let transition: Transition = { kind: "none" };
  if (sample !== null) transition = step(open, sample, s.maxGapMin * 60);
  else if (open !== null) transition = closeIfStale(open, nowSec, s.sessionStaleMin * 60);
  const stmt = transitionStatement(db, transition, row?.id ?? null, s, timeZone);
  return stmt === null ? [] : [stmt];
}
```

**File: `test/charge-flow.test.ts`**

```ts
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollOnce } from "../src/poll";
import { AWAY, T0, mockApiSequence, resetDb, setHomeAndPrices, vehicleBody } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await setHomeAndPrices();
});
afterEach(() => vi.restoreAllMocks());

describe("charge flow", () => {
  it("SES-10 COST-1 builds a costed session from a full charge", async () => {
    const f = mockApiSequence([
      vehicleBody({ ts: "2026-10-31T21:50Z", state: "READY_FOR_CHARGING", soc: 20 }),
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6, soc: 20 }),
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6, soc: 20 }),
      vehicleBody({ ts: "2026-10-31T22:20Z", state: "CHARGING", kw: 3.6, soc: 26 }),
      vehicleBody({ ts: "2026-10-31T22:30Z", state: "READY_FOR_CHARGING", kw: 0, soc: 28 }),
    ]);
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push(await pollOnce(env, T0 + i * 600));
    expect(outcomes).toEqual(["stored", "stored", "unchanged", "stored", "stored"]);
    expect(f).toHaveBeenCalledTimes(5);

    const row = await env.DB.prepare("SELECT * FROM charge_session").first<Record<string, number | string>>();
    expect(row?.status).toBe("closed");
    expect(row?.end_reason).toBe("charge_ended");
    expect(row?.local_month).toBe("2026-11"); // 00:00 on 1 Nov in Helsinki
    expect(row?.kwh_by_power).toBeCloseTo(1.5, 6);
    expect(row?.kwh_by_soc).toBeCloseTo(1.6, 6);
    expect(row?.kwh_source).toBe("power");
    expect(row?.cost_energy_c).toBeCloseTo(15, 6); // 1.5 kWh at 8 c + 25 % VAT
    expect(row?.cost_total_c).toBeCloseTo(15, 6);
  });
  it("COST-3 leaves cost empty until prices are complete", async () => {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'vat_percent'").run();
    mockApiSequence([
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6, soc: 20 }),
      vehicleBody({ ts: "2026-10-31T22:10Z", state: "READY_FOR_CHARGING", soc: 22 }),
    ]);
    await pollOnce(env, T0);
    await pollOnce(env, T0 + 600);
    const row = await env.DB.prepare("SELECT status, kwh_used, cost_total_c FROM charge_session").first<Record<string, number | null>>();
    expect(row?.kwh_used).toBeCloseTo(0.3, 6);
    expect(row?.cost_total_c).toBeNull();
  });
  it("SES-1 HOME-3 opens a session when position is unknown but the car stayed plugged in", async () => {
    mockApiSequence([
      vehicleBody({ ts: "2026-10-31T21:50Z", state: "READY_FOR_CHARGING" }),
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6, parking: { state: "IN_MOTION" } }),
    ]);
    await pollOnce(env, T0);
    await pollOnce(env, T0 + 600);
    const row = await env.DB.prepare("SELECT status FROM charge_session").first();
    expect(row).toEqual({ status: "open" });
  });
  it("SES-1 ignores a charge away from home", async () => {
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 7, parking: { state: "PARKED", gpsCoordinates: AWAY } })]);
    await pollOnce(env, T0);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM charge_session").first()).toEqual({ n: 0 });
  });
  it("SES-5 closes a session when the car goes silent", async () => {
    const same = vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6 });
    mockApiSequence([same, same]);
    await pollOnce(env, T0);
    await pollOnce(env, T0 + 200 * 60);
    expect(await env.DB.prepare("SELECT status, end_reason FROM charge_session").first()).toEqual({ status: "closed", end_reason: "stale" });
  });
});
```


**Done when:** `pnpm check` passes.

**Commit:** `feat: build costed sessions from snapshots`.

### Task 2.3 `[MODEL]` Maintenance and session routes

**Implements:** SES-11, COST-4, API-4, API-5, API-6.

- **Rebuild** deletes sessions in a time range and replays stored snapshots. It lets Phase 1 data become sessions. It cannot detect `stale` closes in the middle of a range, because snapshots carry no wall-clock time, so a long silence counts as a gap instead.
- **Recompute** applies the current prices, battery size and energy source to all closed sessions. Run it after changing settings.

**File: `src/maintenance.ts`**

```ts
import { step, type OpenSession } from "./session";
import { insertClosed, totalsFor } from "./session-store";
import type { Sample } from "./sample";
import type { Settings } from "./settings";

type SnapshotRow = {
  captured_at: number;
  plug_state: string | null;
  charge_state: string | null;
  charge_power_kw: number | null;
  soc_percent: number | null;
  odometer_km: number | null;
  at_home: number | null;
};

const toSample = (r: SnapshotRow): Sample => ({
  capturedAt: r.captured_at,
  plugState: r.plug_state,
  chargeState: r.charge_state,
  powerKw: r.charge_power_kw,
  socPercent: r.soc_percent,
  odometerKm: r.odometer_km,
  atHome: r.at_home === null ? null : r.at_home === 1,
});

// Replays snapshots in [from, to) through the same state machine as the live poll.
// The caller must make sure no session is open.
export async function rebuildSessions(db: D1Database, from: number, to: number, s: Settings, timeZone: string): Promise<number> {
  const { results } = await db
    .prepare("SELECT * FROM snapshot WHERE captured_at >= ? AND captured_at < ? ORDER BY captured_at")
    .bind(from, to)
    .all<SnapshotRow>();
  const writes = [db.prepare("DELETE FROM charge_session WHERE started_at >= ? AND started_at < ?").bind(from, to)];
  let current: OpenSession | null = null;
  for (const row of results) {
    const t = step(current, toSample(row), s.maxGapMin * 60);
    if (t.kind === "open" || t.kind === "update") current = t.session;
    if (t.kind === "close") {
      writes.push(insertClosed(db, t.session, t.endedAt, t.reason, s, timeZone));
      current = null;
    }
  }
  if (current !== null) writes.push(insertClosed(db, current, current.lastSampleAt, "stale", s, timeZone));
  await db.batch(writes);
  return writes.length - 1;
}

type ClosedRow = { id: number; kwh_by_power: number; gap_count: number; start_soc: number | null; end_soc: number | null };

// Applies the current prices, battery size and energy source to every closed session.
export async function recomputeCosts(db: D1Database, s: Settings): Promise<number> {
  const { results } = await db.prepare("SELECT id, kwh_by_power, gap_count, start_soc, end_soc FROM charge_session WHERE status = 'closed'").all<ClosedRow>();
  const writes = results.map((r) => {
    const t = totalsFor(r.kwh_by_power, r.gap_count, r.start_soc, r.end_soc, s);
    return db
      .prepare("UPDATE charge_session SET kwh_by_soc = ?, kwh_used = ?, kwh_source = ?, cost_energy_c = ?, cost_transfer_c = ?, cost_tax_c = ?, cost_total_c = ? WHERE id = ?")
      .bind(t.bySoc, t.kwh, t.source, t.cost?.energyC ?? null, t.cost?.transferC ?? null, t.cost?.taxC ?? null, t.cost?.totalC ?? null, r.id);
  });
  if (writes.length > 0) await db.batch(writes);
  return writes.length;
}
```

**File: `src/session-routes.ts`**

```ts
import type { Hono } from "hono";
import { recomputeCosts, rebuildSessions } from "./maintenance";
import type { AppEnv } from "./routes";
import { loadSettings } from "./settings";

const MONTH = /^\d{4}-\d{2}$/;

export function registerSessionRoutes(app: Hono<AppEnv>): void {
  app.get("/api/months", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT local_month AS month, COUNT(*) AS sessions, SUM(kwh_used) AS kwh, SUM(cost_energy_c) AS energy_c, SUM(cost_transfer_c) AS transfer_c,
       SUM(cost_tax_c) AS tax_c, SUM(cost_total_c) AS total_c FROM charge_session WHERE status = 'closed' GROUP BY local_month ORDER BY local_month DESC LIMIT 24`,
    ).all();
    return c.json({ months: results });
  });

  app.get("/api/sessions", async (c) => {
    const month = c.req.query("month") ?? "";
    if (!MONTH.test(month)) return c.json({ error: "month must be YYYY-MM" }, 400);
    const { results } = await c.env.DB.prepare("SELECT * FROM charge_session WHERE local_month = ? ORDER BY started_at DESC").bind(month).all();
    return c.json({ sessions: results });
  });

  app.post("/api/sessions/recompute-cost", async (c) => {
    const updated = await recomputeCosts(c.env.DB, await loadSettings(c.env.DB));
    return c.json({ updated });
  });

  app.post("/api/sessions/rebuild", async (c) => {
    const from = Number(c.req.query("from"));
    const to = Number(c.req.query("to"));
    if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) return c.json({ error: "from and to must be unix seconds" }, 400);
    const open = await c.env.DB.prepare("SELECT id FROM charge_session WHERE status = 'open'").first();
    if (open !== null) return c.json({ error: "a session is open; retry after it closes" }, 409);
    const sessions = await rebuildSessions(c.env.DB, from, to, await loadSettings(c.env.DB), c.env.TIMEZONE);
    return c.json({ sessions });
  });
}
```

**File: `src/index.ts`**

```ts
import { pollOnce } from "./poll";
import { app } from "./routes";
import { registerSessionRoutes } from "./session-routes";

registerSessionRoutes(app);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(pollOnce(env, Math.floor(Date.now() / 1000)));
  },
} satisfies ExportedHandler<Env>;
```

**File: `test/maintenance.test.ts`**

```ts
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recomputeCosts, rebuildSessions } from "../src/maintenance";
import { pollOnce } from "../src/poll";
import { loadSettings } from "../src/settings";
import { T0, authedHeaders, mockApiSequence, mockFetch, resetDb, setHomeAndPrices, vehicleBody } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await setHomeAndPrices();
});
afterEach(() => vi.restoreAllMocks());

const COLUMNS = "started_at, ended_at, end_reason, local_month, start_soc, end_soc, kwh_by_power, kwh_by_soc, cost_total_c";

async function liveCharge() {
  mockApiSequence([
    vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6, soc: 20 }),
    vehicleBody({ ts: "2026-10-31T22:20Z", state: "CHARGING", kw: 3.6, soc: 26 }),
    vehicleBody({ ts: "2026-10-31T22:30Z", state: "READY_FOR_CHARGING", kw: 0, soc: 28 }),
  ]);
  for (let i = 0; i < 3; i++) await pollOnce(env, T0 + i * 600);
  vi.restoreAllMocks();
}

describe("maintenance", () => {
  it("SES-11 rebuild reproduces the live session", async () => {
    await liveCharge();
    const live = await env.DB.prepare(`SELECT ${COLUMNS} FROM charge_session`).first();
    await env.DB.prepare("DELETE FROM charge_session").run();
    expect(await rebuildSessions(env.DB, T0 - 3600, T0 + 7200, await loadSettings(env.DB), env.TIMEZONE)).toBe(1);
    expect(await env.DB.prepare(`SELECT ${COLUMNS} FROM charge_session`).first()).toEqual(live);
  });
  it("COST-4 recompute applies new prices", async () => {
    await liveCharge();
    await env.DB.prepare("UPDATE settings SET value = '20' WHERE key = 'energy_price_c_per_kwh'").run();
    expect(await recomputeCosts(env.DB, await loadSettings(env.DB))).toBe(1);
    const row = await env.DB.prepare("SELECT cost_total_c FROM charge_session").first<{ cost_total_c: number }>();
    expect(row?.cost_total_c).toBeCloseTo(37.5, 6);
  });
});

describe("session routes", () => {
  const route = async (method: string, path: string) => exports.default.fetch(`https://x${path}`, { method, headers: await authedHeaders() });

  it("API-4 API-5 lists months and sessions", async () => {
    await liveCharge();
    mockFetch(() => new Response("{}"));
    const months = await (await route("GET", "/api/months")).json<{ months: { month: string; sessions: number }[] }>();
    expect(months.months[0]).toMatchObject({ month: "2026-11", sessions: 1 });
    const list = await (await route("GET", "/api/sessions?month=2026-11")).json<{ sessions: unknown[] }>();
    expect(list.sessions).toHaveLength(1);
    expect((await route("GET", "/api/sessions?month=bad")).status).toBe(400);
  });
  it("API-6 recomputes and rebuilds", async () => {
    await liveCharge();
    mockFetch(() => new Response("{}"));
    expect(await (await route("POST", "/api/sessions/recompute-cost")).json()).toEqual({ updated: 1 });
    const rebuilt = await route("POST", `/api/sessions/rebuild?from=${T0 - 3600}&to=${T0 + 7200}`);
    expect(await rebuilt.json()).toEqual({ sessions: 1 });
  });
  it("API-6 refuses a rebuild while a session is open", async () => {
    await env.DB.prepare("INSERT INTO charge_session (status, started_at, local_month, last_sample_at) VALUES ('open', 1, '2026-11', 1)").run();
    mockFetch(() => new Response("{}"));
    expect((await route("POST", "/api/sessions/rebuild?from=0&to=100")).status).toBe(409);
  });
  it("API-6 validates the rebuild range", async () => {
    mockFetch(() => new Response("{}"));
    expect((await route("POST", "/api/sessions/rebuild?from=100&to=0")).status).toBe(400);
  });
});
```


**Done when:** `pnpm check` and `pnpm check:specs 2` pass.

**Commit:** `feat: add session routes, rebuild and cost recompute`.

### Task 2.4 `[HUMAN]` Deploy and backfill

1. Deploy with `pnpm deploy`.
2. Fill in the prices from a bill. In the browser, on the Worker's URL while logged in, open the developer console and run this with your real values:

   ```js
   await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
     energy_price_includes_vat: false,
     transfer_price_c_per_kwh: 0,
     transfer_price_includes_vat: true,
     electricity_tax_c_per_kwh: 0,
     electricity_tax_includes_vat: true,
     vat_percent: 0,
   }) }).then((r) => r.json());
   ```

   Those numbers are placeholders. Replace every one, and apply any `max_gap_min` or `session_stale_min` values from Task 1.6.

3. Rebuild Phase 1 data. Set the first date to the day of your first deployment. Wait until no charge is running, or the route returns 409.

   ```js
   const from = Math.floor(Date.parse("2026-11-01T00:00:00Z") / 1000);
   const to = Math.floor(Date.now() / 1000);
   await fetch(`/api/sessions/rebuild?from=${from}&to=${to}`, { method: "POST", headers: { "Content-Type": "application/json" } }).then((r) => r.json());
   ```

4. Compare the sessions with what you remember: count, start times and SoC change.

```bash
pnpm exec wrangler d1 execute phev-cost-tracker --remote --command "SELECT datetime(started_at,'unixepoch') AS started, end_reason, start_soc, end_soc, round(kwh_by_power,2) AS kwh_power, round(kwh_by_soc,2) AS kwh_soc, gap_count, kwh_source, round(cost_total_c/100,2) AS eur FROM charge_session ORDER BY started_at DESC LIMIT 20"
```

**Done when:** every real charge has one session, no away charges appear, and `kwh_power` and `kwh_soc` are in the same range.

---

## Phase 3: Dashboard and alerts

### Task 3.1 `[MODEL]` Alerts

**Implements:** ALERT-1 to ALERT-6.

**File: `src/alerts.ts`**

```ts
import { loadPollState, type PollStateRow } from "./poll";

const DAY = 86400;
const KEY_WARNING_SECONDS = 14 * DAY;
const FAILURE_THRESHOLD = 3;
const SILENCE_SECONDS = 6 * 3600;
const RESEND_SECONDS = DAY;

export type Alert = { key: string; message: string };

export function dueAlerts(st: PollStateRow, nowSec: number): Alert[] {
  const alerts: Alert[] = [];
  if (st.key_expires_at !== null && st.key_expires_at - nowSec <= KEY_WARNING_SECONDS) {
    const days = Math.max(0, Math.ceil((st.key_expires_at - nowSec) / DAY));
    alerts.push({ key: "key_expiring", message: `Škoda API key expires in ${days} day(s). Create a new one in the MyŠkoda app.` });
  }
  if (st.auth_failures >= FAILURE_THRESHOLD) {
    alerts.push({ key: "auth_failing", message: `Škoda API rejected the key ${st.auth_failures} times in a row.` });
  }
  if (st.rate_limit_failures >= FAILURE_THRESHOLD) {
    alerts.push({ key: "rate_limited", message: `Škoda API rate limited ${st.rate_limit_failures} polls in a row.` });
  }
  if (st.last_success_at !== null && nowSec - st.last_success_at > SILENCE_SECONDS) {
    alerts.push({ key: "no_success", message: "No successful Škoda API poll in over 6 hours." });
  }
  return alerts;
}

export async function runAlerts(env: Env, nowSec: number): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) return;
  const due = dueAlerts(await loadPollState(env.DB), nowSec);
  if (due.length === 0) return;
  const { results } = await env.DB.prepare("SELECT key, last_sent_at FROM alert_log").all<{ key: string; last_sent_at: number }>();
  const sentAt = new Map(results.map((r) => [r.key, r.last_sent_at]));
  for (const alert of due) {
    if (nowSec - (sentAt.get(alert.key) ?? 0) < RESEND_SECONDS) continue;
    const res = await fetch(env.ALERT_WEBHOOK_URL, { method: "POST", body: alert.message, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (res?.ok) {
      await env.DB.prepare("INSERT OR REPLACE INTO alert_log (key, last_sent_at) VALUES (?, ?)").bind(alert.key, nowSec).run();
    }
  }
}
```

**File: `src/index.ts`**

```ts
import { runAlerts } from "./alerts";
import { pollOnce } from "./poll";
import { app } from "./routes";
import { registerSessionRoutes } from "./session-routes";

registerSessionRoutes(app);

async function tick(env: Env): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const outcome = await pollOnce(env, nowSec);
  if (outcome !== "skipped") await runAlerts(env, nowSec);
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(tick(env));
  },
} satisfies ExportedHandler<Env>;
```

**File: `test/alerts.test.ts`**

```ts
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dueAlerts, runAlerts } from "../src/alerts";
import type { PollStateRow } from "../src/poll";
import { T0, resetDb } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const DAY = 86400;
const healthy: PollStateRow = {
  last_poll_at: T0,
  last_success_at: T0,
  not_before: null,
  last_captured_at: null,
  last_plug_state: null,
  last_at_home: null,
  key_expires_at: T0 + 30 * DAY,
  rate_limit_remaining: 15,
  auth_failures: 0,
  rate_limit_failures: 0,
};
const keys = (st: PollStateRow) => dueAlerts(st, T0).map((a) => a.key);

describe("dueAlerts", () => {
  it("is quiet when healthy", () => expect(keys(healthy)).toEqual([]));
  it("ALERT-1 warns 14 days before key expiry", () => expect(keys({ ...healthy, key_expires_at: T0 + 14 * DAY })).toEqual(["key_expiring"]));
  it("ALERT-2 warns on repeated auth failures", () => expect(keys({ ...healthy, auth_failures: 3 })).toEqual(["auth_failing"]));
  it("ALERT-3 warns on repeated rate limits", () => expect(keys({ ...healthy, rate_limit_failures: 3 })).toEqual(["rate_limited"]));
  it("ALERT-4 warns after six silent hours", () => expect(keys({ ...healthy, last_success_at: T0 - 6 * 3600 - 1 })).toEqual(["no_success"]));
});

describe("runAlerts", () => {
  const withWebhook = { ...env, ALERT_WEBHOOK_URL: "https://ntfy.sh/test-topic" } as Env;

  beforeEach(() => env.DB.prepare("UPDATE poll_state SET key_expires_at = ?").bind(T0 + DAY).run());

  it("ALERT-6 does nothing without a webhook", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    await runAlerts({ ...env, ALERT_WEBHOOK_URL: "" } as Env, T0);
    expect(f).not.toHaveBeenCalled();
  });
  it("ALERT-5 sends once a day", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok"));
    await runAlerts(withWebhook, T0);
    await runAlerts(withWebhook, T0 + 60);
    expect(f).toHaveBeenCalledTimes(1);
    await runAlerts(withWebhook, T0 + DAY);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("ALERT-5 retries after a failed send", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 500 }));
    await runAlerts(withWebhook, T0);
    await runAlerts(withWebhook, T0 + 60);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
```


**Done when:** `pnpm check` and `pnpm check:specs 3` pass.

**Commit:** `feat: add key expiry and failure alerts`.

### Task 3.2 `[MODEL]` Dashboard

**Implements:** DASH-1 to DASH-10.

There is no code to copy here. Build the page from [dashboard.md](specs/dashboard.md) and [api.md](specs/api.md). Keep it plain: one page, no framework, no build step. Because these requirements are verified by hand, there are no tests to write.

**Setup.** Add the seed file, then load it locally. Never run it with `--remote`.

**File: `scripts/seed-local.sql`**

```sql
-- Synthetic data for looking at the dashboard locally. Never run this with --remote.
INSERT OR REPLACE INTO settings (key, value) VALUES
  ('vat_percent', '25.5'),
  ('energy_price_includes_vat', 'true'),
  ('transfer_price_includes_vat', 'true'),
  ('electricity_tax_includes_vat', 'true'),
  ('transfer_price_c_per_kwh', '5'),
  ('electricity_tax_c_per_kwh', '2.8');

DELETE FROM charge_session;
INSERT INTO charge_session
  (status, started_at, ended_at, end_reason, local_month, start_soc, end_soc, last_sample_at, last_power_kw, kwh_by_power, gap_count, kwh_by_soc, kwh_used, kwh_source, cost_energy_c, cost_transfer_c, cost_tax_c, cost_total_c)
VALUES
  ('closed', 1788382800, 1788400800, 'charge_ended', '2026-09', 18, 92, 1788400800, 0, 14.2, 0, 14.8, 14.2, 'power', 113.6, 71.0, 39.8, 224.4),
  ('closed', 1790974800, 1790990000, 'unplugged', '2026-10', 30, 88, 1790990000, 0, 11.3, 0, 11.6, 11.3, 'power', 90.4, 56.5, 31.6, 178.5),
  ('closed', 1791579600, 1791596000, 'charge_ended', '2026-10', 22, 95, 1791596000, 0, 13.9, 2, 14.6, 14.6, 'soc', 116.8, 73.0, 40.9, 230.7);

UPDATE poll_state SET last_poll_at = unixepoch(), last_success_at = unixepoch(), last_captured_at = unixepoch() - 600,
  key_expires_at = unixepoch() + 20 * 86400, rate_limit_remaining = 14;

DELETE FROM poll_error;
INSERT INTO poll_error (at, kind, http_status, problem_type) VALUES (unixepoch() - 7200, 'partial', 200, 'CHARGING_UNAVAILABLE');
```


```bash
mkdir -p public/vendor
cp node_modules/chart.js/dist/chart.umd.min.js public/vendor/
pnpm migrate:local
pnpm exec wrangler d1 execute phev-cost-tracker --local --file scripts/seed-local.sql
pnpm dev
```

Open `http://localhost:8787`.

**Done when:**

- Every DASH requirement holds with the seed data, at desktop and 375 px widths, in light and dark mode.
- `pnpm check` still passes.

**Commit:** `feat: add dashboard`. Stage `public/` and `scripts/seed-local.sql`.

### Task 3.3 `[HUMAN]` Final deployment

**Verifies:** SEC-6, OPS-1, OPS-2, OPS-3.

1. Optional: set up alerts. Pick a long random ntfy.sh topic, because anyone who knows it can read the messages.

   ```bash
   pnpm exec wrangler secret put ALERT_WEBHOOK_URL
   ```

2. Run `pnpm deploy`.
3. In a private window, confirm the dashboard needs a login.
4. Confirm this returns a redirect to the Access login page or a 403, and not JSON:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-WORKER-URL/api/health
   ```

5. Check real CPU time in the Worker's **Metrics** tab after a few days.
6. Compare a full month of `kwh_used` with your Helen bill. If the bill is clearly higher, see [Open items](#open-items).
7. Set a calendar reminder for the API key's expiry date.

**Done when:** all of the above check out and the dashboard shows real data.

---

## Phase 4: Optional, not specified

These stay out of scope until the first three phases have run for a while: €/km from the odometer, a JSON endpoint for a Home Assistant REST sensor, and wall-side measurement from a smart plug. Plan them separately.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_PNPM_IGNORED_BUILDS` | `pnpm-workspace.yaml` is missing | Create it as in Task 0.3 |
| Tests see rows from another test | D1 data persists between tests in a file | Call `resetDb` in `beforeEach`, as in the existing tests |
| `no such table` in tests | `setupFiles` is missing or the migration has an error | Compare `vitest.config.ts` with Task 0.3 |
| Property does not exist on `Env` | Generated types are stale, or `.dev.vars` is missing | Run `cp .dev.vars.example .dev.vars`, then `pnpm typecheck` |
| `TEST_MIGRATIONS` does not exist on `Env` | `test/env.d.ts` is missing | Create it as in Task 0.3 |
| 403 on POST from the dashboard | `Content-Type` header is missing | Send `application/json` |
| 403 on every API call when deployed | `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN` is wrong | Compare with the Access app, then redeploy |
| `poll_error` fills with `auth`, 401 | Key expired or was revoked | Create a new key, then run `wrangler secret put SKODA_API_KEY` |
| `poll_error` fills with `auth`, 403 | Key not bound to this car, or wrong VIN | Check the key's vehicles in the MyŠkoda app |
| Polling seems to stop | `not_before` is set after a 429 or auth failures | Check `/api/health`. It clears by itself |
| No sessions open | `at_home` is NULL or 0 | Check `home_set` and `home_radius_m` |
| "Exceeded CPU Limit" errors | Over the 10 ms free-tier cap | Stop and tell the user. First suspects are large rebuild ranges, so rebuild one month at a time |
| A test fails after copying the code | Copy error | Compare against this plan. Do not edit the test |
| `unknown requirement` from `check:specs` | A test title has a mistyped ID | Fix the title to match the spec |
| `no test` from `check:specs` | A test file from this phase is missing | Compare with the phase's tasks. Do not change `Verified by` |

## Open items

1. **Wall kWh may be higher than both estimates.** The spec does not say whether `chargePowerInKw` is measured at the wall or at the battery. `PLAN.md` treats the gap between the estimates as charger losses, but if both are battery-side, the true cost is higher than shown, likely by the charger's losses. Task 3.3 step 6 compares with the bill (OPS-3). If the bill is clearly higher, add an efficiency setting in a separate change.
2. **Start of charge.** A charge is first seen at the next poll, up to 15 minutes late. Energy before that is not counted. Phase 1 data shows how much this matters.
3. **12 V battery.** It is still unknown whether polling affects a sleeping car. Watch for `vehicle-not-accepting-requests` in the errors. If it appears, raise `poll_interval_idle_min`.
4. **Key lifetime.** The expiry date is only known from the first real response header, so confirm it is parsed once deployed. `key_expires_at` must not stay NULL in `/api/health`.
5. **Prices.** `PLAN.md`'s open items on VAT, transfer and tax remain. They are filled in during Task 2.4.

## Verification already done

Checked on 2026-10-31 in a scratch project, using exact pinned versions:

| Check | Result |
|---|---|
| Rebuilt the project from this file's code blocks and `specs/`, task by task | Passed. Tests, typecheck, spec coverage and deploy dry run were clean after every task. Tests passing at the end of each phase: Phase 0: 1, Phase 1: 55, Phase 2: 89, Phase 3: 97 |
| Local run: migrations, `wrangler dev`, static page, health route, cron trigger | Passed |
| Real Škoda API with a placeholder key | Returned 401, recorded as an `auth` error |
| Deploy dry run | Passed, about 32 KB gzipped |
| Local run of `scripts/seed-local.sql` | Passed |

Not tested, because they need real accounts or the car: a valid API key through this Worker, real deployment and Access login, real CPU time, and whether the car's reporting pattern matches the assumptions. Phase 1 exists to check those. The dashboard is specified in `specs/dashboard.md` but not built.

Sources: [Škoda API docs](https://public.api.connect.skoda-auto.cz/docs), [Škoda OpenAPI spec](https://public.api.connect.skoda-auto.cz/v3/api-docs), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/), [Validating Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
