import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recomputeCosts, rebuildSessions } from "../src/maintenance";
import { pollOnce } from "../src/poll";
import { loadSettings } from "../src/settings";
import { T0, authedHeaders, mockApiSequence, mockFetch, resetDb, setHomeAndPrices, vehicleBody } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await setHomeAndPrices();
});
afterEach(() => vi.restoreAllMocks());

const COLUMNS = "started_at, ended_at, end_reason, local_month, start_soc, end_soc, kwh_by_power, kwh_by_soc, cost_total_c";

async function liveCharge() {
  mockApiSequence([
    vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6, soc: 20 }),
    vehicleBody({ ts: "2026-10-31T22:20Z", state: "CHARGING", kw: 3.6, soc: 26 }),
    vehicleBody({ ts: "2026-10-31T22:30Z", state: "READY_FOR_CHARGING", kw: 0, soc: 28 }),
  ]);
  for (let i = 0; i < 3; i++) await pollOnce(env, T0 + i * 600);
  vi.restoreAllMocks();
}

describe("maintenance", () => {
  it("SES-11 rebuild reproduces the live session", async () => {
    await liveCharge();
    const live = await env.DB.prepare(`SELECT ${COLUMNS} FROM charge_session`).first();
    await env.DB.prepare("DELETE FROM charge_session").run();
    expect(await rebuildSessions(env.DB, T0 - 3600, T0 + 7200, await loadSettings(env.DB), env.TIMEZONE)).toBe(1);
    expect(await env.DB.prepare(`SELECT ${COLUMNS} FROM charge_session`).first()).toEqual(live);
  });
  it("COST-4 recompute applies new prices", async () => {
    await liveCharge();
    await env.DB.prepare("UPDATE settings SET value = '20' WHERE key = 'energy_price_c_per_kwh'").run();
    expect(await recomputeCosts(env.DB, await loadSettings(env.DB))).toBe(1);
    const row = await env.DB.prepare("SELECT cost_total_c FROM charge_session").first<{ cost_total_c: number }>();
    expect(row?.cost_total_c).toBeCloseTo(37.5, 6);
  });
});

describe("session routes", () => {
  const route = async (method: string, path: string) => exports.default.fetch(`https://x${path}`, { method, headers: await authedHeaders() });

  it("API-4 API-5 lists months and sessions", async () => {
    await liveCharge();
    mockFetch(() => new Response("{}"));
    const months = await (await route("GET", "/api/months")).json<{ months: { month: string; sessions: number }[] }>();
    expect(months.months[0]).toMatchObject({ month: "2026-11", sessions: 1 });
    const list = await (await route("GET", "/api/sessions?month=2026-11")).json<{ sessions: unknown[] }>();
    expect(list.sessions).toHaveLength(1);
    expect((await route("GET", "/api/sessions?month=bad")).status).toBe(400);
  });
  it("API-6 recomputes and rebuilds", async () => {
    await liveCharge();
    mockFetch(() => new Response("{}"));
    expect(await (await route("POST", "/api/sessions/recompute-cost")).json()).toEqual({ updated: 1 });
    const rebuilt = await route("POST", `/api/sessions/rebuild?from=${T0 - 3600}&to=${T0 + 7200}`);
    expect(await rebuilt.json()).toEqual({ sessions: 1 });
  });
  it("API-6 refuses a rebuild while a session is open", async () => {
    await env.DB.prepare("INSERT INTO charge_session (status, started_at, local_month, last_sample_at) VALUES ('open', 1, '2026-11', 1)").run();
    mockFetch(() => new Response("{}"));
    expect((await route("POST", "/api/sessions/rebuild?from=0&to=100")).status).toBe(409);
  });
  it("API-6 validates the rebuild range", async () => {
    mockFetch(() => new Response("{}"));
    expect((await route("POST", "/api/sessions/rebuild?from=100&to=0")).status).toBe(400);
  });
});
