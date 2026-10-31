# Location

### HOME-1: At home

Phase: 1. Verified by: test.

When the car reports `PARKED` with coordinates and a home position is set, `at_home` shall be true if the distance to home is at most `home_radius_m` (default 50), otherwise false.

### HOME-2: Unknown location

Phase: 1. Verified by: test.

When no home position is set, or the car reports no coordinates and HOME-3 does not apply, `at_home` shall be unknown.

### HOME-3: Stayed plugged in

Phase: 1. Verified by: test.

When the car reports no coordinates, and the plug is `CONNECTED` now and was `CONNECTED` on the previous known reading, `at_home` shall keep its last known value.

### HOME-4: Capture home

Phase: 1. Verified by: test.

`POST /setup/home` shall read the car's position and store it as home, and shall spend one API request doing so. It shall answer `409` if the car is not reporting a parked position, and `409` if home is already set unless `force=1` is passed. It shall answer `409` without calling the API while the current time is before `not_before`. Its response shall be handled as in POLL-6 to POLL-10.
