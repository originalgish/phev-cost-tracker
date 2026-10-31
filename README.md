# PHEV Cost Tracker

Answers one question: how much does it cost to charge my Škoda Kodiaq PHEV at home?

The tracker polls the Škoda Connect API, turns the car's readings into charge sessions, and prices them at your fixed electricity price. It is single-user and self-hosted: you bring your own API key and run it on your own Cloudflare account. Home charging only.

**Status:** built through Phase 3 and deployed. Every push to `main` that passes the checks is deployed automatically. The first-time setup steps are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and need the owner's Cloudflare login and car.

## How it works

1. **Poll.** A cron runs every 5 minutes. A gate calls the API only when a poll is due: every 10 minutes while the plug is connected, 15 minutes otherwise. It backs off after rate limits, repeated auth failures and low quota.
2. **Snapshot.** Each new car reading becomes one row: plug and charge state, power, state of charge (SoC), odometer and an at-home flag. No GPS coordinates are stored.
3. **At home.** The parked position is compared with the home position captured once at setup, within 50 m. If the car reports no position, the last known value carries over while it stays plugged in; otherwise it is unknown.
4. **Session.** A session opens when the car is plugged in, charging and at home. It closes on unplug, when charging ends, or after 180 minutes of silence. Charges away from home are ignored.
5. **Energy.** Each session gets two estimates: integrated charge power, and the change in SoC times usable battery size. Billed energy uses the power estimate and falls back to SoC if that has gaps.
6. **Cost.** Billed kWh times the contract's energy price (7.87 c/kWh, VAT included). The price and the other tuning values are constants in [src/config.ts](src/config.ts); a price change is a code change followed by **Recompute all costs**.
7. **Alerts.** Optional webhook, for example ntfy.sh. Sent for a key expiring within 14 days, three auth or rate-limit failures in a row, or no successful poll for 6 hours. Each kind is sent at most once a day.

## Architecture

- **Worker** in TypeScript with [Hono](https://hono.dev): `fetch` serves the API and dashboard, `scheduled` runs the poll.
- **D1** (SQLite) stores snapshots, sessions, the home position, poll state, errors and alert log. Schema: [migrations/0001_init.sql](migrations/0001_init.sql).
- **Dashboard** is a static page in [public/](public/) with Chart.js: monthly cost, session list and data health.
- **Access**: Cloudflare Access covers all traffic to the Worker. The Worker also verifies the Access JWT on `/api/*` and `/setup/*`.
- **Free tier**: built for Workers and D1 free-tier limits, including 10 ms of CPU per invocation. CPU time is checked after deployment.

| Route | Purpose |
|---|---|
| `GET /api/health` | Poll status, whether home is set, key expiry, quota and recent errors. The home position is never returned |
| `POST /setup/home` | Store the car's current parked position as home |
| `GET /api/months` | Monthly totals, newest first |
| `GET /api/sessions?month=YYYY-MM` | Sessions in one month |
| `POST /api/sessions/recompute-cost` | Reprice all closed sessions |
| `POST /api/sessions/rebuild?from=&to=` | Rebuild sessions from stored snapshots |

## Layout

```text
src/            Worker code: poll, gate, session, cost, routes, alerts
specs/          behaviour, the source of truth
test/           Vitest tests; each title names its requirement ID
public/         dashboard
migrations/     D1 schema
scripts/        spec checker and local seed data
```

## Develop

Requires Node 22 or newer and pnpm 12.

```bash
pnpm install
cp .dev.vars.example .dev.vars    # local placeholders; never commit real values
pnpm migrate:local
pnpm dev                          # http://localhost:8787
```

On `localhost` only, `DEV_AUTH_BYPASS=1` skips Access. It has no effect on other hosts.

Load synthetic data for the dashboard. Never run this with `--remote`:

```bash
pnpm exec wrangler d1 execute phev-cost-tracker --local --file scripts/seed-local.sql
```

Run the checks:

```bash
pnpm check           # tests, typecheck and spec coverage
pnpm check:specs 3   # also require a test for every requirement up to phase 3
```

Behaviour changes follow [specs/README.md](specs/README.md): spec, then a failing test with the requirement ID in its title, then code, then `pnpm check`, then one commit.

## Deploy

[GitHub Actions](.github/workflows/ci.yml) runs `pnpm check` on every push and pull request. On a push to `main` that passes, it applies D1 migrations and then deploys the Worker. Migrations run first, so a migration must not break the version that is still running.

The workflow needs two repository secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token comes from the **Edit Cloudflare Workers** template with **D1: Edit** added. Worker secrets such as the Škoda API key stay in Wrangler and are not touched by a deploy.

## Documentation

- [PLAN.md](PLAN.md): goal and reasoning.
- [specs/](specs/README.md): how the tracker behaves. [specs/decisions.md](specs/decisions.md) lists where the specs differ from PLAN.md.
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): build order, deployment steps and open items.

## Privacy and secrets

This repository is public. The API key, the VIN, raw API output and the home position must never be committed, logged or returned by a route. Local secrets live in `.dev.vars`, which is git-ignored. Deployed secrets live in Wrangler secrets.

## Known limits

- Energy figures are estimates from the car's readings. How they compare with the electricity bill is still open; see the open items in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
- A charge is first seen at the next poll, up to 15 minutes late, so energy before that is not counted.
