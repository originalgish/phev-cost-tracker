import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollOnce } from "../src/poll";
import { AWAY, T0, apiResponse, fullVehicleBody, mockApiSequence, resetDb, setHome, vehicleBody } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

describe("pollOnce", () => {
  it("POLL-4 stores one snapshot per car timestamp", async () => {
    await setHome();
    mockApiSequence([
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "READY_FOR_CHARGING" }),
      vehicleBody({ ts: "2026-10-31T22:00Z", state: "READY_FOR_CHARGING" }),
      vehicleBody({ ts: "2026-10-31T22:10Z", state: "CHARGING", kw: 3.6, soc: 21 }),
    ]);
    expect(await pollOnce(env, T0)).toBe("stored");
    expect(await pollOnce(env, T0 + 900)).toBe("unchanged");
    expect(await pollOnce(env, T0 + 1800)).toBe("stored");
    expect(await count("snapshot")).toBe(2);
    const row = await env.DB.prepare("SELECT * FROM snapshot ORDER BY captured_at DESC").first();
    expect(row).toEqual({
      captured_at: Date.parse("2026-10-31T22:10:00Z") / 1000,
      plug_state: "CONNECTED",
      charge_state: "CHARGING",
      charge_power_kw: 3.6,
      soc_percent: 21,
      odometer_km: 1000,
      at_home: 1,
    });
  });
  it("POLL-2 does not call the API when the gate is closed", async () => {
    await env.DB.prepare("UPDATE poll_state SET last_poll_at = ?").bind(T0).run();
    const before = await env.DB.prepare("SELECT * FROM poll_state").first();
    const f = vi.spyOn(globalThis, "fetch");
    expect(await pollOnce(env, T0 + 300)).toBe("skipped");
    expect(f).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT * FROM poll_state").first()).toEqual(before);
  });
  it("POLL-6 POLL-8 honours Retry-After and logs a 429", async () => {
    const body = { type: "https://public.api.connect.skoda-auto.cz/problems/rate-limit-exceeded" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 429, headers: { "Retry-After": "600" } }));
    expect(await pollOnce(env, T0)).toBe("error");
    const state = await env.DB.prepare("SELECT not_before, rate_limit_failures FROM poll_state").first();
    expect(state).toEqual({ not_before: T0 + 600, rate_limit_failures: 1 });
    expect(await env.DB.prepare("SELECT kind, problem_type FROM poll_error").first()).toEqual({ kind: "rate_limit", problem_type: "rate-limit-exceeded" });
    expect(await pollOnce(env, T0 + 599)).toBe("skipped");
  });
  it("POLL-9 clears failure counters after a success", async () => {
    await env.DB.prepare("UPDATE poll_state SET auth_failures = 2, rate_limit_failures = 2").run();
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z" })]);
    await pollOnce(env, T0);
    expect(await env.DB.prepare("SELECT auth_failures, rate_limit_failures FROM poll_state").first()).toEqual({ auth_failures: 0, rate_limit_failures: 0 });
  });
  it("POLL-10 records key expiry and quota", async () => {
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z" })]);
    await pollOnce(env, T0);
    const state = await env.DB.prepare("SELECT key_expires_at, rate_limit_remaining FROM poll_state").first();
    expect(state).toEqual({ key_expires_at: Date.parse("2026-12-01T00:00:00Z") / 1000, rate_limit_remaining: 15 });
  });
  it("POLL-5 logs a partial 200 without storing a snapshot", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiResponse({ vehicle: {}, errors: [{ type: "CHARGING_UNAVAILABLE" }] }));
    expect(await pollOnce(env, T0)).toBe("partial");
    expect(await env.DB.prepare("SELECT kind, problem_type FROM poll_error").first()).toEqual({ kind: "partial", problem_type: "CHARGING_UNAVAILABLE" });
    expect(await count("snapshot")).toBe(0);
  });
  it("POLL-5 POLL-8 survives a 200 with no vehicle", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiResponse({ errors: [{ type: "VEHICLE_UNAVAILABLE" }] }));
    expect(await pollOnce(env, T0)).toBe("partial");
    expect(await env.DB.prepare("SELECT problem_type FROM poll_error").first()).toEqual({ problem_type: "VEHICLE_UNAVAILABLE" });
    expect(await env.DB.prepare("SELECT last_poll_at FROM poll_state").first()).toEqual({ last_poll_at: T0 });
  });
  it("POLL-5 POLL-8 survives a null body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiResponse(null));
    expect(await pollOnce(env, T0)).toBe("partial");
    expect(await env.DB.prepare("SELECT problem_type FROM poll_error").first()).toEqual({ problem_type: "missing-charging" });
  });
  it("HOME-1 HOME-2 stores at_home 0 away and NULL before home is set", async () => {
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z" })]);
    await pollOnce(env, T0);
    expect(await env.DB.prepare("SELECT at_home FROM snapshot").first()).toEqual({ at_home: null });
    await setHome();
    vi.restoreAllMocks();
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:30Z", plug: "DISCONNECTED", parking: { state: "PARKED", gpsCoordinates: AWAY } })]);
    await pollOnce(env, T0 + 1800);
    expect(await env.DB.prepare("SELECT at_home FROM snapshot ORDER BY captured_at DESC").first()).toEqual({ at_home: 0 });
  });
  it("HOME-3 carries at_home over while the car stays plugged in", async () => {
    await setHome();
    mockApiSequence([
      vehicleBody({ ts: "2026-10-31T22:00Z" }),
      vehicleBody({ ts: "2026-10-31T22:10Z", parking: { state: "IN_MOTION" } }),
    ]);
    await pollOnce(env, T0);
    await pollOnce(env, T0 + 600);
    expect(await env.DB.prepare("SELECT at_home FROM snapshot ORDER BY captured_at DESC").first()).toEqual({ at_home: 1 });
  });
  it("HOME-3 keeps at_home through a reading with no plug state", async () => {
    await setHome();
    const noPlug = vehicleBody({ ts: "2026-10-31T22:10Z", parking: { state: "IN_MOTION" } });
    Object.assign(noPlug.vehicle.charging.status, { plugConnectionState: undefined });
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z" }), noPlug, vehicleBody({ ts: "2026-10-31T22:20Z", parking: { state: "IN_MOTION" } })]);
    for (let i = 0; i < 3; i++) await pollOnce(env, T0 + i * 600);
    expect(await env.DB.prepare("SELECT at_home FROM snapshot ORDER BY captured_at DESC").first()).toEqual({ at_home: 1 });
  });
  it("HOME-2 HOME-3 does not carry at_home across a drive", async () => {
    await setHome();
    mockApiSequence([
      vehicleBody({ ts: "2026-10-31T22:00Z", plug: "DISCONNECTED" }),
      vehicleBody({ ts: "2026-10-31T22:15Z", plug: "DISCONNECTED", parking: { state: "IN_MOTION" } }),
      vehicleBody({ ts: "2026-10-31T22:30Z", parking: { state: "IN_MOTION" } }),
      vehicleBody({ ts: "2026-10-31T22:45Z", parking: { state: "IN_MOTION" } }),
    ]);
    for (let i = 0; i < 4; i++) await pollOnce(env, T0 + i * 900);
    expect(await env.DB.prepare("SELECT at_home FROM snapshot ORDER BY captured_at DESC").first()).toEqual({ at_home: null });
  });
  it("POLL-11 deletes logged errors after 30 days", async () => {
    await env.DB.prepare("INSERT INTO poll_error (at, kind) VALUES (?, 'server')").bind(T0 - 31 * 86400).run();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    await pollOnce(env, T0);
    expect(await env.DB.prepare("SELECT at FROM poll_error").all().then((r) => r.results)).toEqual([{ at: T0 }]);
  });
  it("POLL-11 also deletes them when logging a partial response", async () => {
    await env.DB.prepare("INSERT INTO poll_error (at, kind) VALUES (?, 'server')").bind(T0 - 31 * 86400).run();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(apiResponse({ vehicle: {}, errors: [{ type: "CHARGING_UNAVAILABLE" }] }));
    await pollOnce(env, T0);
    expect(await env.DB.prepare("SELECT at FROM poll_error").all().then((r) => r.results)).toEqual([{ at: T0 }]);
  });
  it("SEC-5 never stores GPS coordinates", async () => {
    await setHome();
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z" })]);
    await pollOnce(env, T0);
    const row = await env.DB.prepare("SELECT * FROM snapshot").first();
    expect(Object.keys(row ?? {})).not.toContain("latitude");
    expect(JSON.stringify(row)).not.toContain("60.17");
  });
});

const carState = async () => {
  const { results } = await env.DB.prepare("SELECT part, captured_at, data FROM vehicle_state ORDER BY part").all<{ part: string; captured_at: number | null; data: string }>();
  return Object.fromEntries(results.map((r) => [r.part, { captured_at: r.captured_at, ...JSON.parse(r.data) }]));
};

describe("car state", () => {
  it("POLL-3 asks for every part the dashboard shows", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(apiResponse({ vehicle: {} }));
    await pollOnce(env, T0);
    const parts = new URL(String(f.mock.calls[0]?.[0])).searchParams.getAll("include");
    expect(parts.sort()).toEqual(["airConditioning", "charging", "fuelStatus", "odometer", "parkingPosition", "status"]);
  });
  it("POLL-12 stores the latest state of each part", async () => {
    mockApiSequence([fullVehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING", kw: 2 })]);
    await pollOnce(env, T0);
    const at = Date.parse("2026-10-31T22:00:00Z") / 1000;
    expect(await carState()).toEqual({
      charging: { captured_at: at, state: "CHARGING", plug_state: "CONNECTED", power_kw: 2, soc_percent: 57, range_km: 54, target_soc_percent: 100, minutes_to_full: 280 },
      fuelStatus: { captured_at: at, total_range_km: 584, fuel_percent: 90 },
      status: { captured_at: at, locked: "LOCKED" },
      airConditioning: { captured_at: at, state: "OFF", target_temp: 20, target_temp_unit: "CELSIUS" },
      odometer: { captured_at: at, km: 1000 },
    });
  });
  it("POLL-12 replaces old values, storing NULL for what the car stopped reporting", async () => {
    const later = fullVehicleBody({ ts: "2026-10-31T22:10Z", state: "READY_FOR_CHARGING" });
    Object.assign(later.vehicle.charging.status, { remainingTimeToFullyChargedInMinutes: undefined });
    mockApiSequence([fullVehicleBody({ ts: "2026-10-31T22:00Z", state: "CHARGING" }), later]);
    await pollOnce(env, T0);
    await pollOnce(env, T0 + 900);
    expect((await carState()).charging).toMatchObject({ captured_at: Date.parse("2026-10-31T22:10:00Z") / 1000, state: "READY_FOR_CHARGING", minutes_to_full: null });
  });
  it("POLL-12 keeps the old state of a part the response lacks", async () => {
    const partial = fullVehicleBody({ ts: "2026-10-31T22:10Z" });
    Reflect.deleteProperty(partial.vehicle, "fuelStatus");
    Reflect.deleteProperty(partial.vehicle, "airConditioning");
    mockApiSequence([fullVehicleBody({ ts: "2026-10-31T22:00Z" }), partial]);
    await pollOnce(env, T0);
    await pollOnce(env, T0 + 900);
    const state = await carState();
    const first = Date.parse("2026-10-31T22:00:00Z") / 1000;
    expect(state.fuelStatus).toMatchObject({ captured_at: first, total_range_km: 584 });
    expect(state.airConditioning).toMatchObject({ captured_at: first });
    expect(state.status.captured_at).toBe(Date.parse("2026-10-31T22:10:00Z") / 1000);
  });
  it("POLL-12 stores car state even when charging is missing", async () => {
    const body = fullVehicleBody({ ts: "2026-10-31T22:00Z" });
    Reflect.deleteProperty(body.vehicle, "charging");
    mockApiSequence([{ ...body, errors: [{ type: "CHARGING_UNAVAILABLE" }] }]);
    expect(await pollOnce(env, T0)).toBe("partial");
    expect(Object.keys(await carState())).toEqual(["airConditioning", "fuelStatus", "odometer", "status"]);
  });
  it("POLL-12 picks the lock state and the fuel engine by what the API says, not by position", async () => {
    const body = fullVehicleBody({ ts: "2026-10-31T22:00Z" });
    const { primaryEngineRange, secondaryEngineRange } = body.vehicle.fuelStatus;
    Object.assign(body.vehicle.fuelStatus, { primaryEngineRange: secondaryEngineRange, secondaryEngineRange: primaryEngineRange });
    body.vehicle.status.overall = { locked: "NO", reliableLockStatus: "UNKNOWN" };
    mockApiSequence([body]);
    await pollOnce(env, T0);
    const state = await carState();
    expect(state.fuelStatus.fuel_percent).toBe(90);
    expect(state.status.locked).toBe("UNLOCKED");
  });
  it("POLL-12 stores a missing field as NULL", async () => {
    mockApiSequence([vehicleBody({ ts: "2026-10-31T22:00Z" })]);
    await pollOnce(env, T0);
    expect((await carState()).charging).toMatchObject({ range_km: null, target_soc_percent: null, minutes_to_full: null });
  });
  it("SEC-8 never stores the VIN, plate, name or coordinates", async () => {
    await setHome();
    mockApiSequence([fullVehicleBody({ ts: "2026-10-31T22:00Z" })]);
    await pollOnce(env, T0);
    const { results } = await env.DB.prepare("SELECT * FROM vehicle_state").all();
    const stored = JSON.stringify(results);
    for (const secret of ["SECRETVIN", "Secret name", "SECRET-1", "60.17", "24.94", "gps", "latitude"]) expect(stored).not.toContain(secret);
  });
});
