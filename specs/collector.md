# Collector

Timing and thresholds below are defaults. Those marked as settings are in `settings`.

### POLL-1: Polling cadence

Phase: 1. Verified by: test.

The tracker shall check every 5 minutes whether a poll is due. A poll is due when no poll has happened yet, or when the time since the last poll is at least `poll_interval_plugged_min` (default 10) if the plug was last known `CONNECTED`, otherwise `poll_interval_idle_min` (default 15). A check up to 60 seconds early still counts as due.

### POLL-2: No call when not due

Phase: 1. Verified by: test.

When a poll is not due, or the current time is before `not_before`, the tracker shall make no Škoda API call and write nothing.

### POLL-3: Vehicle request

Phase: 1. Verified by: test.

A poll shall request the vehicle with the `X-API-Key` header and repeated `include` parameters for `charging`, `parkingPosition` and `odometer`.

### POLL-4: One snapshot per car update

Phase: 1. Verified by: test.

The tracker shall store a snapshot only when `charging.carCapturedTimestamp` is newer than the last stored one. A snapshot holds the car's time, plug state, charge state, charge power, SoC, odometer and `at_home`.

### POLL-5: Partial responses

Phase: 1. Verified by: test.

When a `200` response has no usable `charging.carCapturedTimestamp`, the tracker shall store no snapshot and log a `partial` error naming the types in `errors`.

### POLL-6: Rate limit backoff

Phase: 1. Verified by: test.

When the API answers `429`, the tracker shall not poll again until `Retry-After` has passed, or for 1 hour if the header is absent. `Retry-After` may be seconds or an HTTP date.

### POLL-7: Other backoff

Phase: 1. Verified by: test.

The tracker shall pause polling in these cases:

- any other failure with `Retry-After`: until it has passed
- 3 or more authentication failures in a row: for 1 hour
- `RateLimit-Remaining` of 1 or less: for `RateLimit-Reset` seconds

### POLL-8: Failure handling

Phase: 1. Verified by: test.

The tracker shall classify `401` and `403` as `auth`, `429` as `rate_limit`, connection failures as `network`, and any other failure or invalid JSON as `server`. It shall log each one with its time, kind, HTTP status and problem type, and shall survive it without crashing the poll.

### POLL-9: Recovery

Phase: 1. Verified by: test.

After a successful response, the tracker shall reset its consecutive failure counts to zero.

### POLL-10: Key expiry and quota

Phase: 1. Verified by: test.

The tracker shall record `X-API-Key-Expires-At` and `RateLimit-Remaining` from each response, ignoring values it cannot parse.

### POLL-11: Error retention

Phase: 1. Verified by: test.

When logging an API error, the tracker shall delete logged API errors older than 30 days.
