import { runAlerts } from "./alerts/alerts";
import { pollOnce } from "./poll/poll";
import { app } from "./routes/routes";
import { registerSessionRoutes } from "./session/session-routes";

registerSessionRoutes(app);

async function tick(env: Env): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const outcome = await pollOnce(env, nowSec);
  if (outcome !== "skipped") await runAlerts(env, nowSec);
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(tick(env));
  },
} satisfies ExportedHandler<Env>;
