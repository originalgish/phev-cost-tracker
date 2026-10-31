# Alerts

Alerts are plain-text POSTs to `ALERT_WEBHOOK_URL`, which works with ntfy.sh. They are checked after every poll that was due.

### ALERT-1: Key expiry

Phase: 3. Verified by: test.

When the API key expires within 14 days, the tracker shall send an alert with the days left.

### ALERT-2: Authentication failures

Phase: 3. Verified by: test.

After 3 or more authentication failures in a row, the tracker shall send an alert.

### ALERT-3: Rate limiting

Phase: 3. Verified by: test.

After 3 or more rate-limited polls in a row, the tracker shall send an alert.

### ALERT-4: Silence

Phase: 3. Verified by: test.

When the last successful poll was more than 6 hours ago, the tracker shall send an alert.

### ALERT-5: Repeats

Phase: 3. Verified by: test.

Each kind of alert shall be sent at most once a day. A failed send shall not count, so it is tried again at the next poll.

### ALERT-6: No webhook

Phase: 3. Verified by: test.

When `ALERT_WEBHOOK_URL` is empty or unset, the tracker shall send nothing.
