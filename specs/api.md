# HTTP API

All routes here are subject to [security.md](security.md). Money is in cents and times are unix seconds.

### API-1: Health

Phase: 1. Verified by: test.

`GET /api/health` shall return `home_set`, `last_poll_at`, `last_success_at`, `last_captured_at`, `not_before`, `key_expires_at`, `rate_limit_remaining`, `open_session` and the 10 most recent `errors` (`at`, `kind`, `http_status`, `problem_type`).

### API-2: Read settings

Phase: 1. Verified by: manual.

Removed: there are no editable settings. `home_set` is part of API-1.

### API-3: Write settings

Phase: 1. Verified by: manual.

Removed: there are no editable settings. The home position is set only by `POST /setup/home`.

### API-4: Months

Phase: 2. Verified by: test.

`GET /api/months` shall return `months`, newest first, at most 24, each with `month`, `sessions`, `kwh` and `cost_c`, counting closed sessions only.

### API-5: Sessions

Phase: 2. Verified by: test.

`GET /api/sessions?month=YYYY-MM` shall return `sessions` for that month, newest first, and answer `400` if `month` is malformed.

### API-6: Maintenance

Phase: 2. Verified by: test.

`POST /api/sessions/recompute-cost` shall do COST-4 and return `{ updated }`. `POST /api/sessions/rebuild?from=&to=` shall do SES-11 for unix seconds `from` to `to` and return `{ sessions }`. It shall answer `400` for an invalid range and `409` while a session is open.

### API-7: Car state

Phase: 4. Verified by: test.

`GET /api/vehicle` shall return an object keyed by part name (`charging`, `fuelStatus`, `status`, `airConditioning`, `odometer`). Each value shall be `captured_at` plus the fields of POLL-12 for that part. A part the tracker has never stored shall be absent.
