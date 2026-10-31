-- One row per distinct charging.carCapturedTimestamp. No GPS, by design.
CREATE TABLE snapshot (
  captured_at     INTEGER PRIMARY KEY,   -- unix seconds
  plug_state      TEXT,
  charge_state    TEXT,
  charge_power_kw REAL,
  soc_percent     INTEGER,
  odometer_km     INTEGER,
  at_home         INTEGER CHECK (at_home IN (0, 1))  -- NULL = unknown
);

CREATE TABLE charge_session (
  id              INTEGER PRIMARY KEY,
  status          TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  started_at      INTEGER NOT NULL UNIQUE,
  ended_at        INTEGER,
  end_reason      TEXT CHECK (end_reason IN ('unplugged', 'charge_ended', 'stale')),
  local_month     TEXT NOT NULL,         -- 'YYYY-MM' in TIMEZONE, at session start
  start_soc       INTEGER,
  end_soc         INTEGER,
  last_sample_at  INTEGER NOT NULL,
  last_power_kw   REAL,
  kwh_by_power    REAL NOT NULL DEFAULT 0,
  gap_count       INTEGER NOT NULL DEFAULT 0,
  kwh_by_soc      REAL,
  kwh_used        REAL,
  kwh_source      TEXT CHECK (kwh_source IN ('power', 'soc')),
  cost_energy_c   REAL,
  cost_transfer_c REAL,
  cost_tax_c      REAL,
  cost_total_c    REAL
);
CREATE UNIQUE INDEX charge_session_one_open ON charge_session (status) WHERE status = 'open';
CREATE INDEX charge_session_month ON charge_session (local_month);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('energy_price_c_per_kwh', '8'),
  ('transfer_price_c_per_kwh', '0'),
  ('electricity_tax_c_per_kwh', '0'),
  ('battery_usable_kwh', '20'),
  ('home_radius_m', '50'),
  ('poll_interval_plugged_min', '10'),
  ('poll_interval_idle_min', '15'),
  ('max_gap_min', '45'),
  ('session_stale_min', '180'),
  ('cost_energy_source', 'power');

CREATE TABLE poll_state (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  last_poll_at        INTEGER,
  last_success_at     INTEGER,
  not_before          INTEGER,
  last_captured_at    INTEGER,
  last_plug_state     TEXT,
  last_at_home        INTEGER,
  key_expires_at      INTEGER,
  rate_limit_remaining INTEGER,
  auth_failures       INTEGER NOT NULL DEFAULT 0,
  rate_limit_failures INTEGER NOT NULL DEFAULT 0
);
INSERT INTO poll_state (id) VALUES (1);

CREATE TABLE poll_error (
  id           INTEGER PRIMARY KEY,
  at           INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  http_status  INTEGER,
  problem_type TEXT
);
CREATE INDEX poll_error_at ON poll_error (at);

CREATE TABLE alert_log (
  key          TEXT PRIMARY KEY,
  last_sent_at INTEGER NOT NULL
);
