# Dashboard

One static page with no framework and no build step: `public/index.html`, `public/app.js`, `public/style.css`, and Chart.js from `public/vendor/`. Data comes from [api.md](api.md).

To check any of these requirements, load the seed data and open `http://localhost:8787`. Use `localhost`, because SEC-3 does not apply to `127.0.0.1`.

### DASH-1: Banners

Phase: 3. Verified by: manual.

The page shall show one line for each of these that applies:

- `home_set` is false: "Home position not set. Sessions cannot start."
- `key_expires_at` is less than 14 days away: "API key expires on DATE."
- `last_success_at` is more than 1 hour ago: "No successful poll since TIME."

### DASH-2: Month selector

Phase: 3. Verified by: manual.

The page shall offer a month selector, newest first. With no months, it shall show "No charging sessions yet" and hide DASH-3, DASH-4 and DASH-5.

### DASH-3: Month stats

Phase: 3. Verified by: manual.

For the selected month, the page shall show total cost in euros, energy in kWh, average price in c/kWh (`cost_c / kwh`) and session count, with `—` for an empty value. With the seed data, October shall show 2.04 € over 2 sessions.

### DASH-4: Monthly chart

Phase: 3. Verified by: manual.

The page shall show bars of `cost_c` in euros for up to 12 months, oldest on the left.

### DASH-5: Session table

Phase: 3. Verified by: manual.

The page shall list the month's sessions, newest first, with start, duration, kWh by power, kWh by SoC, billed kWh with its source, and cost in euros. Rows with gaps shall say "gaps in power data". If `open_session` is set, it shall appear first as "Charging now".

### DASH-6: Data health

Phase: 3. Verified by: manual.

The page shall show last poll, last success, last car data, key expiry, quota remaining and the last 10 errors.

### DASH-7: Settings

Phase: 3. Verified by: manual.

Removed: there are no editable settings.

### DASH-8: Actions

Phase: 3. Verified by: manual.

The page shall have **Recompute all costs** and **Capture home position** buttons, and shall ask for confirmation before replacing a home position that is already set.

### DASH-9: Request handling

Phase: 3. Verified by: manual.

Every POST and PUT shall send `Content-Type: application/json`. API values shall be set with `textContent`, never `innerHTML`. A failed request shall show a visible message.

### DASH-10: Display

Phase: 3. Verified by: manual.

Money shall show as `(c / 100).toFixed(2)` and times as `new Date(seconds * 1000).toLocaleString()`. Colours shall be CSS variables on `:root`, with dark values under `prefers-color-scheme: dark`. At 375 px wide, the page shall not scroll sideways, and the session table shall scroll inside its own container.
