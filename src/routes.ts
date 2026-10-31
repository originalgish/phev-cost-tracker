import { Hono } from "hono";
import { rejectCrossSite, requireAccess } from "./auth";
import { failureWrites, loadPollState, successWrite } from "./poll";
import { loadSettings } from "./settings";
import { fetchVehicle } from "./skoda";

export type AppEnv = { Bindings: Env };

const number = (min: number, max: number) => (v: unknown) => (typeof v === "number" && v >= min && v <= max ? String(v) : null);
const boolean = (v: unknown) => (typeof v === "boolean" ? String(v) : null);
const source = (v: unknown) => (v === "power" || v === "soc" ? v : null);

const EDITABLE: Record<string, (v: unknown) => string | null> = {
  energy_price_c_per_kwh: number(0, 200),
  energy_price_includes_vat: boolean,
  transfer_price_c_per_kwh: number(0, 200),
  transfer_price_includes_vat: boolean,
  electricity_tax_c_per_kwh: number(0, 200),
  electricity_tax_includes_vat: boolean,
  vat_percent: number(0, 100),
  battery_usable_kwh: number(1, 100),
  home_radius_m: number(10, 1000),
  poll_interval_plugged_min: number(5, 60),
  poll_interval_idle_min: number(5, 120),
  max_gap_min: number(5, 240),
  session_stale_min: number(30, 1440),
  cost_energy_source: source,
};

export const app = new Hono<AppEnv>();

app.use("/api/*", rejectCrossSite, requireAccess);
app.use("/setup/*", rejectCrossSite, requireAccess);

app.get("/api/health", async (c) => {
  const st = await loadPollState(c.env.DB);
  const { results } = await c.env.DB.prepare("SELECT at, kind, http_status, problem_type FROM poll_error ORDER BY at DESC LIMIT 10").all();
  const open = await c.env.DB.prepare("SELECT started_at, kwh_by_power, start_soc, end_soc FROM charge_session WHERE status = 'open'").first();
  return c.json({
    last_poll_at: st.last_poll_at,
    last_success_at: st.last_success_at,
    last_captured_at: st.last_captured_at,
    not_before: st.not_before,
    key_expires_at: st.key_expires_at,
    rate_limit_remaining: st.rate_limit_remaining,
    open_session: open,
    errors: results,
  });
});

app.get("/api/settings", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const raw = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const values = Object.fromEntries(Object.keys(EDITABLE).map((k) => [k, raw[k] ?? null]));
  const settings = await loadSettings(c.env.DB);
  return c.json({ values, home_set: settings.homeLat !== null, prices_complete: settings.prices !== null });
});

app.put("/api/settings", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (body === null || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "JSON object required" }, 400);
  const writes: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(body)) {
    // hasOwn, because a key like `toString` would otherwise find Object.prototype.
    const encoded = Object.hasOwn(EDITABLE, key) ? (EDITABLE[key]?.(value) ?? null) : null;
    if (encoded === null) return c.json({ error: `invalid value for ${key}` }, 400);
    writes.push(c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(key, encoded));
  }
  if (writes.length > 0) await c.env.DB.batch(writes);
  return c.json({ updated: writes.length });
});

app.post("/setup/home", async (c) => {
  const db = c.env.DB;
  const settings = await loadSettings(db);
  if (settings.homeLat !== null && c.req.query("force") !== "1") return c.json({ error: "home already set; pass force=1 to replace it" }, 409);
  const nowSec = Math.floor(Date.now() / 1000);
  const state = await loadPollState(db);
  if (state.not_before !== null && nowSec < state.not_before) return c.json({ error: "Škoda API calls are paused; try again later" }, 409);
  const result = await fetchVehicle(c.env, ["parkingPosition"], nowSec);
  if (!result.ok) {
    await db.batch(failureWrites(db, state, result, nowSec));
    return c.json({ error: `Škoda API error: ${result.kind}` }, 502);
  }
  const answered = successWrite(db, result.meta, nowSec);
  const parking = result.body.vehicle?.parkingPosition;
  if (parking?.state !== "PARKED" || parking.gpsCoordinates === undefined) {
    await answered.run();
    return c.json({ error: "car is not reporting a parked position" }, 409);
  }
  const { latitude, longitude } = parking.gpsCoordinates;
  await db.batch([
    answered,
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('home_lat', ?)").bind(String(latitude)),
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('home_lon', ?)").bind(String(longitude)),
  ]);
  return c.json({ home_set: true });
});
