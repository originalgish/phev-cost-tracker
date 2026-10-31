import type { Hono } from "hono";
import { recomputeCosts, rebuildSessions } from "./maintenance";
import type { AppEnv } from "./routes";

const MONTH = /^\d{4}-\d{2}$/;
const SECONDS = /^\d+$/;

export function registerSessionRoutes(app: Hono<AppEnv>): void {
  app.get("/api/months", async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT local_month AS month, COUNT(*) AS sessions, SUM(kwh_used) AS kwh, SUM(cost_c) AS cost_c FROM charge_session WHERE status = 'closed' GROUP BY local_month ORDER BY local_month DESC LIMIT 24`,
    ).all();
    return c.json({ months: results });
  });

  app.get("/api/sessions", async (c) => {
    const month = c.req.query("month") ?? "";
    if (!MONTH.test(month)) return c.json({ error: "month must be YYYY-MM" }, 400);
    const { results } = await c.env.DB.prepare("SELECT * FROM charge_session WHERE local_month = ? ORDER BY started_at DESC").bind(month).all();
    return c.json({ sessions: results });
  });

  app.post("/api/sessions/recompute-cost", async (c) => {
    const updated = await recomputeCosts(c.env.DB);
    return c.json({ updated });
  });

  app.post("/api/sessions/rebuild", async (c) => {
    const rawFrom = c.req.query("from") ?? "";
    const rawTo = c.req.query("to") ?? "";
    const from = Number(rawFrom);
    const to = Number(rawTo);
    if (!SECONDS.test(rawFrom) || !SECONDS.test(rawTo) || to <= from) return c.json({ error: "from and to must be unix seconds" }, 400);
    const open = await c.env.DB.prepare("SELECT id FROM charge_session WHERE status = 'open'").first();
    if (open !== null) return c.json({ error: "a session is open; retry after it closes" }, 409);
    const sessions = await rebuildSessions(c.env.DB, from, to, c.env.TIMEZONE);
    return c.json({ sessions });
  });
}
