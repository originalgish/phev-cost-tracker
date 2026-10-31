# PHEV Home Charging Cost Tracker: High-Level Plan

> [specs/](specs/README.md) now defines the tracker's behaviour and overrides this file where they differ. [specs/decisions.md](specs/decisions.md) lists the differences.

## Goal

Answer one question: **how much money do I spend charging my Škoda Kodiaq PHEV (2025) at home?**

- Tracks home charging sessions only. No petrol, fill-ups or driving segments.
- Single user, single car. The Škoda API terms limit use to personal use (no commercial use, resale or redistribution), so this is a self-host-your-own-key app, not a hosted service.
- No manual data import. The only manual step is one-time setup.

## Data source: official Škoda API

- Base URL: `https://public.api.connect.skoda-auto.cz/api/v1/vehicles/{VIN}`
- Auth: `X-API-Key` header. The key is created in the MyŠkoda app (8.16+), is bound to selected vehicles, and **expires** (see the `X-API-Key-Expires-At` response header).
- Rate limit: **20 requests/hour per VIN** (not final; read the `RateLimit-*` headers).
- `GET .../{VIN}?include=charging&include=parkingPosition` returns what we need.
- Verified on the target car with `probe.py` (HTTP 200). Fields available:
  - `charging.status.state` (e.g. `CHARGING`), `plugConnectionState`, `chargePowerInKw`, `battery.stateOfChargeInPercent`
  - `parkingPosition.state` and `gpsCoordinates`
  - `odometer.mileageInKm` (optional, for a future €/km feature)
  - `carCapturedTimestamp` on each section
- Not supported on this car: charging profiles, so `isVehicleInSavedLocation` is always `false`. "At home" is decided by the app via GPS.
- Not provided by the API: charging-session history, trip data, kWh measured at the wall. We build sessions from our own polling.

## Stack and deployment

- **TypeScript on Cloudflare Workers** with Hono for routes.
- **D1** (SQLite) for storage.
- **Cron Triggers** for polling. Minimum is every minute; we use every 10 minutes while plugged in and 15 to 30 minutes otherwise. Timing is best-effort, so always use the car's `carCapturedTimestamp`, not poll time.
- **Secrets** (Wrangler secrets): Škoda API key and VIN.
- **Dashboard** is static HTML plus a small chart library, protected by **Cloudflare Access**.
- Not deployed on the Raspberry Pi: Home Assistant OS does not allow running Docker beside it, and a cloud worker avoids gaps from the Pi being offline.

### Free-tier check (verified against Cloudflare docs, Oct 2026; recheck before relying on margins)

| Limit | Free tier | Our usage (estimate) |
|---|---|---|
| Worker requests | 100,000/day | ~150 polls/day plus dashboard views |
| Cron Triggers | 5 per account | 1 to 2 |
| Subrequests per invocation | 50 | 2 to 3 |
| D1 rows written | 100,000/day | A few hundred/day |
| D1 rows read | 5 million/day | Thousands/day |
| D1 storage | 500 MB per database | Megabytes for years |
| **CPU time per invocation** | **10 ms** | Must stay light (see below) |

Design consequence of the 10 ms CPU cap (waiting on network does not count): store only the fields we use, never the full raw JSON; update sessions incrementally with small queries; query the dashboard by month. Measure real CPU time on the first deploy.

## Pricing model (fixed contract)

Helen contract is **fixed price, 8 c/kWh**. No spot-price fetcher is needed.

Session cost = `kWh × (energy_price + transfer_price + electricity_tax)`, with VAT applied according to settings. All of these are **parameters**, none hard-coded:

| Setting | Initial value | Notes |
|---|---|---|
| `energy_price_c_per_kwh` | 8 | Fixed Helen price |
| `energy_price_includes_vat` | TBD | Check the contract or bill |
| `transfer_price_c_per_kwh` | 0 | Network company fee; take from the bill |
| `electricity_tax_c_per_kwh` | 0 | Take from the bill |
| `vat_percent` | TBD | Applied to components not already including VAT |
| `battery_usable_kwh` | ~20 | For the SoC-based cross-check |
| `home_radius_m` | 50 | |

The dashboard shows the total and the breakdown by component.

## Data model (D1)

- `snapshot`: car timestamp, plug state, charge state, `charge_power_kw`, SoC, odometer, `at_home` (boolean). **No GPS coordinates stored per snapshot.**
- `charge_session`: start and end time, start and end SoC, `kwh_by_power`, `kwh_by_soc`, cost breakdown, status (open or closed).
- `settings`: the parameters above, the home position (captured at setup) and key expiry date.

## Core logic

1. **Poll.** The cron handler fetches `charging` and `parkingPosition`. It skips the write if `carCapturedTimestamp` is unchanged. At the end of a charge, it closes the session.
2. **At home.** Compare the parked position to the stored home position, using `home_radius_m`. Store only the boolean. Sessions away from home are discarded.
3. **Session.** Opens when plug is `CONNECTED`, state is `CHARGING` and the car is at home. Closes when charging stops or the plug disconnects.
4. **Energy.** Two estimates, shown side by side:
   - Power-based: Σ `chargePowerInKw` × time between snapshots.
   - SoC-based: ΔSoC × `battery_usable_kwh`.
   The gap shows charger losses and tells us which one to trust. A smart plug or wallbox reading would replace both.
5. **Cost.** Energy × price from settings.
6. **Alerts.** Warn well before key expiry, and on repeated 401/403 or 429 responses (honour `Retry-After`).

## One-time setup

1. Create an API key in the MyŠkoda app for the Kodiaq.
2. Store `SKODA_API_KEY` and `SKODA_VIN` as Wrangler secrets.
3. Deploy the Worker, D1 database and Cloudflare Access policy.
4. With the car parked and charging at home, call `POST /setup/home`. The Worker reads the car's position and stores it as home.
5. Fill in the pricing parameters.

## Dashboard

- Monthly total cost and kWh; average c/kWh.
- Session list: date, duration, kWh (both estimates), cost, with breakdown.
- Data-health panel: last successful poll, key expiry, recent API errors.

## Build phases

1. **Collector.** Worker, cron poll, D1 schema, `snapshot` writes, home capture. Verify on a few real charges.
2. **Sessions and cost.** Session state machine, both energy estimates, cost from parameters.
3. **Dashboard and alerts.** UI, Cloudflare Access, key-expiry and error alerts.
4. **Optional.** €/km using the odometer, JSON endpoint for a Home Assistant REST sensor, wall-side measurement if a smart plug exists.

## Open items

- Whether the 8 c/kWh includes VAT, and the transfer and tax rates (take from the bill).
- Real-world agreement between `chargePowerInKw` and ΔSoC (known only after a few days of data).
- Whether polling a sleeping car causes any 12 V battery drain. Keep the cadence conservative.

## Security notes

- The API key used in the probe was shared in a chat transcript. **Revoke it and create a fresh key** before the real deployment.
- Keep the key, VIN and any raw API output out of any repository.
- Store only the `at_home` boolean per snapshot. The single home position lives in settings, behind Cloudflare Access.
