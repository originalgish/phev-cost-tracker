import { pollOnce } from "./poll";
import { app } from "./routes";

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(pollOnce(env, Math.floor(Date.now() / 1000)));
  },
} satisfies ExportedHandler<Env>;
