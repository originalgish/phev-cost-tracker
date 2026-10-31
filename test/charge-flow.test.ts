import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollOnce } from "../src/poll";
import { AWAY, T0, mockApiSequence, resetDb, setHomeAndPrices, vehicleBody } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await setHomeAndPrices();
});
afterEach(() => vi.restoreAllMocks());

describe("charge flow", () => {
  it("SES-10 COST-1 builds a costed session from a full charge", async () => {
    const f = mockApiSequence([
      vehicleBody({ ts: "2026-10-31T21:50Z", state: "READY_FOR_CHARGING", soc: 20 }),
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6, soc: 20 }),
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6, soc: 20 }),
      vehicleBody({ ts: "2026-10-31T22:20Z", state: "CHARGING", kw: 3.6, soc: 26 }),
      vehicleBody({ ts: "2026-10-31T22:30Z", state: "READY_FOR_CHARGING", kw: 0, soc: 28 }),
    ]);
    const outcomes = [];
    for (let i = 0; i < 5; i++) outcomes.push(await pollOnce(env, T0 + i * 600));
    expect(outcomes).toEqual(["stored", "stored", "unchanged", "stored", "stored"]);
    expect(f).toHaveBeenCalledTimes(5);

    const row = await env.DB.prepare("SELECT * FROM charge_session").first<Record<string, number | string>>();
    expect(row?.status).toBe("closed");
    expect(row?.end_reason).toBe("charge_ended");
    expect(row?.local_month).toBe("2026-11"); // 00:00 on 1 Nov in Helsinki
    expect(row?.kwh_by_power).toBeCloseTo(1.5, 6);
    expect(row?.kwh_by_soc).toBeCloseTo(1.6, 6);
    expect(row?.kwh_source).toBe("power");
    expect(row?.cost_energy_c).toBeCloseTo(15, 6); // 1.5 kWh at 8 c + 25 % VAT
    expect(row?.cost_total_c).toBeCloseTo(15, 6);
  });
  it("COST-3 leaves cost empty until prices are complete", async () => {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'vat_percent'").run();
    mockApiSequence([
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6, soc: 20 }),
      vehicleBody({ ts: "2026-10-31T22:10Z", state: "READY_FOR_CHARGING", soc: 22 }),
    ]);
    await pollOnce(env, T0);
    await pollOnce(env, T0 + 600);
    const row = await env.DB.prepare("SELECT status, kwh_used, cost_total_c FROM charge_session").first<Record<string, number | null>>();
    expect(row?.kwh_used).toBeCloseTo(0.3, 6);
    expect(row?.cost_total_c).toBeNull();
  });
  it("SES-1 HOME-3 opens a session when position is unknown but the car stayed plugged in", async () => {
    mockApiSequence([
      vehicleBody({ ts: "2026-10-31T21:50Z", state: "READY_FOR_CHARGING" }),
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6, parking: { state: "IN_MOTION" } }),
    ]);
    await pollOnce(env, T0);
    await pollOnce(env, T0 + 600);
    const row = await env.DB.prepare("SELECT status FROM charge_session").first();
    expect(row).toEqual({ status: "open" });
  });
  it("SES-1 ignores a charge away from home", async () => {
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 7, parking: { state: "PARKED", gpsCoordinates: AWAY } })]);
    await pollOnce(env, T0);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM charge_session").first()).toEqual({ n: 0 });
  });
  it("SES-5 closes a session when the car goes silent", async () => {
    const same = vehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 3.6 });
    mockApiSequence([same, same]);
    await pollOnce(env, T0);
    await pollOnce(env, T0 + 200 * 60);
    expect(await env.DB.prepare("SELECT status, end_reason FROM charge_session").first()).toEqual({ status: "closed", end_reason: "stale" });
  });
});
