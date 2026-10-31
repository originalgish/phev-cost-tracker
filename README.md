# PHEV Cost Tracker

Answers one question: how much does it cost to charge my Škoda Kodiaq PHEV at home?

The tracker polls the Škoda Connect API, turns the car's readings into charge sessions, and prices them at your fixed electricity price. It is single-user and self-hosted, because the Škoda API terms allow personal use only: you bring your own API key and run it on your own Cloudflare account. Home charging only.

**Status:** deployed. Every merge to `main` is deployed automatically.

## How it works

1. **Poll.** A cron runs every 5 minutes. A gate calls the API only when a poll is due: every 10 minutes while the plug is connected, 15 minutes otherwise. It backs off after rate limits, repeated auth failures and low quota.
2. **Snapshot.** Each new car reading becomes one row: plug and charge state, power, state of charge (SoC), odometer and an at-home flag. No GPS coordinates are stored. The latest charging, fuel and odometer values are also kept for the dashboard, limited to a fixed list of fields.
3. **At home.** The parked position is compared with the home position captured once at setup, within 50 m. If the car reports no position, the last known value carries over while it stays plugged in; otherwise it is unknown.
4. **Session.** A session opens when the car is plugged in, charging and at home. It closes on unplug, when charging ends, or after 180 minutes of silence. Charges away from home are ignored.
5. **Energy.** Each session gets two estimates: integrated charge power, and the change in SoC times usable battery size. Billed energy uses the power estimate and falls back to SoC if that has gaps.
6. **Cost.** Billed kWh times the contract's energy price (7.87 c/kWh, VAT included). The price and the other tuning values are constants in [src/config.ts](src/config.ts); a price change is a code change followed by **Recompute all costs**.
7. **Alerts.** Optional webhook, for example ntfy.sh. Sent for a key expiring within 14 days, three auth or rate-limit failures in a row, or no successful poll for 6 hours. Each kind is sent at most once a day.

## Architecture

- **Worker** in TypeScript with [Hono](https://hono.dev): `fetch` serves the API and dashboard, `scheduled` runs the poll.
- **D1** (SQLite) stores snapshots, sessions, the latest car state, the home position, poll state, errors and alert log. Schema: [migrations/](migrations/).
- **Dashboard** is a static page in [public/](public/) with Chart.js: current car state, monthly cost, session list and data health. Its files are served with a Content-Security-Policy limited to the page's own origin.
- **Access**: Cloudflare Access covers all traffic to the Worker. The Worker also verifies the Access JWT on `/api/*` and `/setup/*`.
- **Free tier**: built for Workers and D1 free-tier limits, including 10 ms of CPU per invocation. CPU time is checked after deployment.

| Route | Purpose |
|---|---|
| `GET /api/health` | Poll status, whether home is set, key expiry, quota and recent errors. The home position is never returned |
| `GET /api/vehicle` | Latest stored car state, by API part |
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
pnpm check:specs 4   # also require a test for every requirement up to phase 4
```

Behaviour changes follow [specs/README.md](specs/README.md): spec, then a failing test with the requirement ID in its title, then code, then `pnpm check`, then one commit.

## Deploy

`main` is protected: every change arrives through a pull request that the owner merges, on a branch that is up to date and has a passing `check`. Direct pushes, force-pushes and deleting `main` are blocked, for the owner too.

[GitHub Actions](.github/workflows/ci.yml) runs `pnpm check` on every pull request and on `main`. After a merge it applies D1 migrations and then deploys the Worker. Migrations run first, so a migration must not break the version that is still running.

The workflow needs two repository secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token comes from the **Edit Cloudflare Workers** template with **D1: Edit** added. Worker secrets such as the Škoda API key stay in Wrangler and are not touched by a deploy.

## First-time setup

This needs a Cloudflare account with Zero Trust enabled and the MyŠkoda app, version 8.16 or newer.

1. In the MyŠkoda app, create an API key bound to the car.
2. Create the database, then put the printed `database_id` into `wrangler.jsonc`:

   ```bash
   pnpm exec wrangler login
   pnpm exec wrangler d1 create phev-cost-tracker
   pnpm migrate:remote
   ```

3. Add the secrets. Paste each value at the prompt, not on the command line. If Wrangler offers to create the Worker, accept. `ALERT_WEBHOOK_URL` is optional. For ntfy.sh, pick a long random topic, because anyone who knows it can read the messages.

   ```bash
   pnpm exec wrangler secret put SKODA_API_KEY
   pnpm exec wrangler secret put SKODA_VIN
   pnpm exec wrangler secret put ALERT_WEBHOOK_URL
   ```

4. Deploy with `pnpm run deploy`. Plain `pnpm deploy` is pnpm's own command, not this script.
5. In the Cloudflare dashboard, open the Worker's **Access** tab and select **Protect this Worker behind Access**. Choose **All traffic** and allow only your own email address.
6. In **Zero Trust**, find the app under **Access** and **Applications**. Put its Application Audience (AUD) tag and your team domain into `vars` in `wrangler.jsonc`, then deploy again. These values and the `database_id` are identifiers, not secrets, but they are public in this repository.
7. Open the Worker's URL in a private window and confirm the Access login appears. After logging in, with the car parked at home, select **Capture home position**.
8. Set your own price and battery size in [src/config.ts](src/config.ts), and add a calendar reminder for the API key's expiry date.

## Documentation

- [specs/](specs/README.md): how the tracker behaves.
- [specs/decisions.md](specs/decisions.md): the design choices behind the specs, and why.

## Privacy and secrets

This repository is public. The API key, the VIN, raw API output and the home position must never be committed, logged or returned by a route. Local secrets live in `.dev.vars`, which is git-ignored. Deployed secrets live in Wrangler secrets.

## Known limits

- Energy figures are estimates from the car's readings. The API does not say whether charge power is measured at the wall or the battery. If it is the battery, the true cost is higher than shown, by the charger's losses. A full month compared with the electricity bill settles this (OPS-3).
- A charge is first seen at the next poll, up to 15 minutes late, so energy before that is not counted.
- Whether polling a sleeping car affects its 12 V battery is unknown. Watch for `vehicle-not-accepting-requests` in the dashboard's errors, and raise `POLL_INTERVAL_IDLE_MIN` in [src/config.ts](src/config.ts) if it appears.
