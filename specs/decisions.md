# Decisions

The design choices behind the specs, and why they were made.

| Topic | Decision | Why |
|---|---|---|
| Hosting | Cloudflare Workers and D1, not the Raspberry Pi | Home Assistant OS does not allow running Docker beside it, and a cloud Worker avoids gaps when the Pi is offline |
| Timestamp | Use `charging.carCapturedTimestamp` only | The API has it on `charging` and `odometer`, not on `parkingPosition` |
| `include` | `charging`, `parkingPosition`, `odometer` | The snapshot stores the odometer, and a part that is not included is absent |
| `include` for the dashboard | Adds `fuelStatus` | The dashboard shows what the My Škoda app shows. The same request carries them, so the quota use is unchanged. Only the fields in POLL-12 are stored |
| `include` format | Repeated params | Verified on the real car by `probe.py`. The API also describes a comma-separated form, which has not been tested on this car |
| Cron | One `*/5 * * * *` cron with a gate in code | A 5-minute tick can hit both the 10-minute and 15-minute cadence. Idle polling stays at 15 minutes |
| `at_home` | True, false or NULL (unknown) | The position can be missing, for example `IN_MOTION` or `PARKING_POSITION_UNAVAILABLE` |
| Prices and settings | Constants in `src/config.ts`; only the home position is stored | One fixed-price contract, no transfer or tax per kWh. A price change is a code change. `POST /api/sessions/recompute-cost` reprices every closed session, so it is only for correcting a wrong constant |
| Which kWh is billed | Power estimate, else SoC | Cost needs one number. It falls back to SoC if the power estimate has gaps |
| Key expiry | In `poll_state` | Every poll updates it |
| Extra tables | `poll_state`, `poll_error`, `alert_log` | Needed for the gate, the health panel and alert de-duplication |
| Alert delivery | Dashboard banner plus optional `ALERT_WEBHOOK_URL` (works with ntfy.sh) | A banner alone is missed if nobody opens the dashboard |
| Access check | Edge Access plus JWT check in the Worker with `jose` | Cloudflare recommends validating the JWT. `ctx.access` is not passed through when Static Assets are used |
| Test tooling | `@cloudflare/vitest-plugin` | It replaces the older `vitest-pool-workers` setup |
