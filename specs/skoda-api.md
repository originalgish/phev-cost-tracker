# Škoda API facts

This is the external contract the tracker depends on, taken from the [OpenAPI spec](https://public.api.connect.skoda-auto.cz/v3/api-docs) and the [API docs](https://public.api.connect.skoda-auto.cz/docs). The API is new, so recheck this file if behaviour changes.

- A `200` can be partial. Missing parts are listed in `errors[].type`, for example `CHARGING_UNAVAILABLE`. A missing field means unknown, not zero.
- `charging.status.state` values: `CONNECT_CABLE`, `CHARGING`, `CONSERVING`, `READY_FOR_CHARGING`, `DISCHARGING`, `CHARGING_INTERRUPTED`. New values can appear. The field is omitted in everyday situations, and an omitted state never means unplugged.
- `plugConnectionState`: `CONNECTED` or `DISCONNECTED`, or omitted.
- `parkingPosition.state`: `PARKED` (with `gpsCoordinates`) or `IN_MOTION` (without).
- `carCapturedTimestamp` exists on `charging` and `odometer`, not on `parkingPosition`. It can have no seconds, for example `2021-06-01T12:00Z`.
- `include` is documented as comma-separated. Repeated parameters are verified on the target car by `probe.py`, so the tracker uses those.
- The rate limit is 20 requests per hour per VIN and is not final. `RateLimit-Remaining` and `RateLimit-Reset` (seconds) are authoritative. `5xx` responses count against the quota. `401` and `403` do not.
- `429` has two problem types: `rate-limit-exceeded` and `vehicle-not-accepting-requests`. The second can mean the car's battery level is too low, so repeated `429`s are also worth checking for 12 V battery reasons.
- Errors use `application/problem+json`. Its `instance` field contains the VIN.
- Whether `chargePowerInKw` is measured at the wall or the battery is not documented.
