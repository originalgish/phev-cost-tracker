# Dashboard

Two static pages with no framework and no build step: the dashboard (`public/index.html`, `public/app.js`, and Chart.js from `public/vendor/`) and the data health page (`public/health.html`, `public/health.js`). Both use `public/common.js` and `public/style.css`. Data comes from [api.md](api.md). "The page" below means the dashboard, unless a requirement says otherwise.

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

A separate page at `/health` shall show last poll, last success, last car data, key expiry, quota remaining and the last 10 errors. The dashboard shall link to it and not show these itself, and DASH-1 shall stay on the dashboard so that a problem is still seen there.

### DASH-7: Settings

Phase: 3. Verified by: manual.

Removed: there are no editable settings.

### DASH-8: Actions

Phase: 3. Verified by: manual.

Removed: both actions are rare maintenance, so the page has no buttons. HOME-4 and API-6 stay as routes, and the README says how to call them.

### DASH-9: Request handling

Phase: 3. Verified by: manual.

API values shall be set with `textContent`, never `innerHTML`. A failed request shall show a visible message.

### DASH-10: Display

Phase: 3. Verified by: manual.

Money shall show as `(c / 100).toFixed(2)` and times as `new Date(seconds * 1000).toLocaleString()`. Colours shall be CSS variables on `:root`, with dark values under `prefers-color-scheme: dark`. At 375 px wide, neither page shall scroll sideways, and tables shall scroll inside their own containers.

### DASH-11: Car now

Phase: 4. Verified by: manual.

Above the month selector, the page shall show a "Car now" card with what the My Škoda app shows, taken from API-7, and `—` for any missing value:

- total range in km, and fuel level in %
- battery charge in %, battery range in km, charge target in %, charge state and power in kW. While the state is `CHARGING` and a time is known, also the time left as `H:MM h left`
- odometer in km
- the newest `captured_at` as "Updated TIME"

The Škoda API offers no consumption averages, so the page shall not show any. With no car state stored, the card shall say "No car data yet".

To check, load the seed data and compare the card with the seed rows of `vehicle_state`.
