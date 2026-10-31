-- Synthetic data for looking at the dashboard locally. Never run this with --remote.
DELETE FROM charge_session;
INSERT INTO charge_session
  (status, started_at, ended_at, end_reason, local_month, start_soc, end_soc, last_sample_at, last_power_kw, kwh_by_power, gap_count, kwh_by_soc, kwh_used, kwh_source, cost_c)
VALUES
  ('closed', 1788382800, 1788400800, 'charge_ended', '2026-09', 18, 92, 1788400800, 0, 14.2, 0, 14.8, 14.2, 'power', 111.8),
  ('closed', 1790974800, 1790990000, 'unplugged', '2026-10', 30, 88, 1790990000, 0, 11.3, 0, 11.6, 11.3, 'power', 88.9),
  ('closed', 1791579600, 1791596000, 'charge_ended', '2026-10', 22, 95, 1791596000, 0, 13.9, 2, 14.6, 14.6, 'soc', 114.9);

UPDATE poll_state SET last_poll_at = unixepoch(), last_success_at = unixepoch(), last_captured_at = unixepoch() - 600,
  key_expires_at = unixepoch() + 20 * 86400, rate_limit_remaining = 14;

DELETE FROM poll_error;
INSERT INTO poll_error (at, kind, http_status, problem_type) VALUES (unixepoch() - 7200, 'partial', 200, 'CHARGING_UNAVAILABLE');
