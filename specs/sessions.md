# Charge sessions

A sample is one new reading from the car. At most one session can be open.

### SES-1: Open a session

Phase: 2. Verified by: test.

When no session is open and a sample has plug `CONNECTED`, state `CHARGING` and `at_home` true, the tracker shall open a session at the sample's time. Any other sample shall open nothing, so charges away from home are not recorded.

### SES-2: Close on unplug

Phase: 2. Verified by: test.

When a session is open and the plug is `DISCONNECTED`, the tracker shall close the session with reason `unplugged`.

### SES-3: Close when charging ends

Phase: 2. Verified by: test.

When a session is open and the state is `CONNECT_CABLE`, `CONSERVING`, `READY_FOR_CHARGING`, `DISCHARGING` or `CHARGING_INTERRUPTED`, the tracker shall close the session with reason `charge_ended`. A later return to charging opens a new session.

### SES-4: Keep open when unsure

Phase: 2. Verified by: test.

When a session is open and the state is `CHARGING`, omitted or not recognised, and the plug is not `DISCONNECTED`, the tracker shall keep the session open.

### SES-5: Close a silent session

Phase: 2. Verified by: test.

When a session is open and the car has sent nothing new for longer than `session_stale_min` (default 180), the tracker shall close the session with reason `stale`, ending at the last sample.

### SES-6: Ignore old samples

Phase: 2. Verified by: test.

The session logic shall ignore a sample that is not newer than the session's last sample.

### SES-7: Energy from power

Phase: 2. Verified by: test.

For each interval between samples, the tracker shall add `(p1 + p2) / 2 × hours` to the power-based energy. A sample that closes the session counts as 0 kW.

### SES-8: Gaps in power data

Phase: 2. Verified by: test.

When an interval is longer than `max_gap_min` (default 45) or a power value is missing, the tracker shall add no energy for it and shall count one gap.

### SES-9: Energy from SoC

Phase: 2. Verified by: test.

The SoC-based energy shall be `(end_soc − start_soc) / 100 × battery_usable_kwh`, never below zero. `end_soc` is the highest SoC seen in the session. If the first sample has no SoC, `start_soc` is the first SoC seen.

### SES-10: Month

Phase: 2. Verified by: test.

A session shall belong to the calendar month, in `TIMEZONE`, of its start time.

### SES-11: Rebuild

Phase: 2. Verified by: test.

Rebuilding a time range shall replace its sessions with the result of replaying stored snapshots through the same rules. A stored session that crosses either end of the range shall be rebuilt whole, so it is neither split nor counted twice. It cannot detect SES-5, so a session still open at the end of the data closes as `stale` at its last sample.
