import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("applies the schema and seeds", async () => {
  const state = await env.DB.prepare("SELECT id FROM poll_state").first();
  expect(state).toEqual({ id: 1 });
  const price = await env.DB.prepare("SELECT value FROM settings WHERE key = 'energy_price_c_per_kwh'").first();
  expect(price).toEqual({ value: "8" });
});
