// Fixed-term electricity contract: 7.87 c/kWh with 25.5 % VAT included, fixed until 2028-02-02.
// The monthly fee does not depend on charging, so it is not part of session cost.
export const ENERGY_PRICE_C_PER_KWH = 7.87;

// Kodiaq PHEV: 25.7 kWh gross, 19.7 kWh usable (Škoda technical data).
export const BATTERY_USABLE_KWH = 19.7;
export const HOME_RADIUS_M = 50;

export const POLL_INTERVAL_PLUGGED_MIN = 10;
export const POLL_INTERVAL_IDLE_MIN = 15;
export const MAX_GAP_MIN = 45;
export const SESSION_STALE_MIN = 180;
