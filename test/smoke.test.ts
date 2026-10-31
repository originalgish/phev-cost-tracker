import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("applies the schema and seeds", async () => {
  const state = await env.DB.prepare("SELECT id FROM poll_state").first();
  expect(state).toEqual({ id: 1 });
  expect(await env.DB.prepare("SELECT key FROM settings").first()).toBeNull();
});
