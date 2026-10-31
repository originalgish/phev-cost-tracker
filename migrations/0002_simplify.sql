-- One price, no editable settings: keep only the home position, and one cost column.
DELETE FROM settings WHERE key NOT IN ('home_lat', 'home_lon');
ALTER TABLE charge_session DROP COLUMN cost_energy_c;
ALTER TABLE charge_session DROP COLUMN cost_transfer_c;
ALTER TABLE charge_session DROP COLUMN cost_tax_c;
ALTER TABLE charge_session RENAME COLUMN cost_total_c TO cost_c;
