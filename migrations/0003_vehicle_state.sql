-- Latest values per API part, for the dashboard. `data` is JSON built from a fixed list of fields (POLL-12).
CREATE TABLE vehicle_state (
  part        TEXT PRIMARY KEY,
  captured_at INTEGER,               -- unix seconds, the part's carCapturedTimestamp
  data        TEXT NOT NULL
);
