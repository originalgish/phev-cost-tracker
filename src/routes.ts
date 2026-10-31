import { Hono } from "hono";
import { rejectCrossSite, requireAccess } from "./auth";
import { failureWrites, loadPollState, successWrite } from "./poll";
import { loadSettings } from "./settings";
import { fetchVehicle } from "./skoda";

export type AppEnv = { Bindings: Env };

export const app = new Hono<AppEnv>();

app.use("/api/*", rejectCrossSite, requireAccess);
app.use("/setup/*", rejectCrossSite, requireAccess);

app.get("/api/health", async (c) => {
  const st = await loadPollState(c.env.DB);
  const { results } = await c.env.DB.prepare("SELECT at, kind, http_status, problem_type FROM poll_error ORDER BY at DESC LIMIT 10").all();
  const open = await c.env.DB.prepare("SELECT started_at, kwh_by_power, start_soc, end_soc FROM charge_session WHERE status = 'open'").first();
  const settings = await loadSettings(c.env.DB);
  return c.json({
    home_set: settings.homeLat !== null,
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

app.get("/api/vehicle", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT part, captured_at, data FROM vehicle_state").all<{ part: string; captured_at: number | null; data: string }>();
  return c.json(Object.fromEntries(results.map((r) => [r.part, { captured_at: r.captured_at, ...JSON.parse(r.data) }])));
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
