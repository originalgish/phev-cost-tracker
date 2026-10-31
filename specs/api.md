# HTTP API

All routes here are subject to [security.md](security.md). Money is in cents and times are unix seconds.

### API-1: Health

Phase: 1. Verified by: test.

`GET /api/health` shall return `last_poll_at`, `last_success_at`, `last_captured_at`, `not_before`, `key_expires_at`, `rate_limit_remaining`, `open_session` and the 10 most recent `errors` (`at`, `kind`, `http_status`, `problem_type`).

### API-2: Read settings

Phase: 1. Verified by: test.

`GET /api/settings` shall return `values` with every editable setting as a string or null, plus `home_set` and `prices_complete`.

### API-3: Write settings

Phase: 1. Verified by: test.

`PUT /api/settings` shall accept a JSON object of editable settings, with numbers and booleans as JSON types, and return `{ updated }`. It shall answer `400` and change nothing if any key is not editable or any value is invalid. The home position is not editable here.

### API-4: Months

Phase: 2. Verified by: test.

`GET /api/months` shall return `months`, newest first, at most 24, each with `month`, `sessions`, `kwh`, `energy_c`, `transfer_c`, `tax_c` and `total_c`, counting closed sessions only.

### API-5: Sessions

Phase: 2. Verified by: test.

`GET /api/sessions?month=YYYY-MM` shall return `sessions` for that month, newest first, and answer `400` if `month` is malformed.

### API-6: Maintenance

Phase: 2. Verified by: test.

`POST /api/sessions/recompute-cost` shall do COST-4 and return `{ updated }`. `POST /api/sessions/rebuild?from=&to=` shall do SES-11 for unix seconds `from` to `to` and return `{ sessions }`. It shall answer `400` for an invalid range and `409` while a session is open.
