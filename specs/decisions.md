# Decisions

Checking `PLAN.md` against the live Škoda OpenAPI spec and the current Cloudflare docs led to these decisions. The specs already reflect them.

| Topic | PLAN.md | This plan | Why |
|---|---|---|---|
| Timestamp | `carCapturedTimestamp` on each section | Use `charging.carCapturedTimestamp` only | The spec has it on `charging` and `odometer`, not on `parkingPosition` |
| `include` | `charging`, `parkingPosition` | Adds `odometer` | The snapshot stores the odometer, and a part that is not included is absent |
| `include` format | Repeated params | Repeated params kept | Verified on the real car by `probe.py`. The spec also describes a comma-separated form, which has not been tested on this car |
| Cron | One or two schedules | One `*/5 * * * *` cron with a gate in code | A 5-minute tick can hit both the 10-minute and 15-minute cadence. Idle polling stays at 15 minutes |
| `at_home` | Boolean | True, false or NULL (unknown) | The position can be missing, for example `IN_MOTION` or `PARKING_POSITION_UNAVAILABLE` |
| VAT flags | One flag, for energy | Three flags, one per component | `PLAN.md` says VAT applies to "components not already including VAT", which needs a flag for each |
| Unset prices | Not covered | Cost stays NULL until all price settings are filled in, then a recompute applies them | A guessed VAT setting would silently produce wrong totals |
| Which kWh is billed | Not covered | New setting `cost_energy_source`, default `power` | Cost needs one number. It falls back to SoC if the power estimate has gaps |
| Key expiry | In `settings` | In `poll_state` | Every poll updates it |
| Extra tables | None | `poll_state`, `poll_error`, `alert_log` | Needed for the gate, the health panel and alert de-duplication |
| Alert delivery | "Warn" | Dashboard banner plus optional `ALERT_WEBHOOK_URL` (works with ntfy.sh) | A banner alone is missed if nobody opens the dashboard |
| Access check | Cloudflare Access at the edge | Edge Access plus JWT check in the Worker with `jose` | Cloudflare recommends validating the JWT. `ctx.access` is not passed through when Static Assets are used |
| Test tooling | Not covered | `@cloudflare/vitest-plugin` | It replaces the older `vitest-pool-workers` setup |
