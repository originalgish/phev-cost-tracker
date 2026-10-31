import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/routes";
import { loadSettings } from "../src/settings";
import { HOME, apiResponse, authedHeaders, mintToken, mockFetch, resetDb } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const get = (path: string, headers?: Record<string, string>) => exports.default.fetch(`https://x${path}`, { headers });
const send = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  exports.default.fetch(`https://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

describe("SEC-1 access", () => {
  it("rejects a request with no token", async () => expect((await get("/api/health")).status).toBe(403));
  it("rejects the wrong audience", async () => {
    mockFetch(() => new Response("{}"));
    expect((await get("/api/health", { "Cf-Access-Jwt-Assertion": await mintToken("other") })).status).toBe(403);
  });
  it("accepts a valid token", async () => {
    mockFetch(() => new Response("{}"));
    expect((await get("/api/health", await authedHeaders())).status).toBe(200);
  });
  it("protects setup", async () => expect((await send("POST", "/setup/home", {})).status).toBe(403));
  it("rejects everything when Access settings are missing", async () => {
    mockFetch(() => new Response("{}"));
    const res = await app.request("https://x/api/health", { headers: await authedHeaders() }, { ...env, ACCESS_AUD: "" });
    expect(res.status).toBe(403);
  });
});

describe("SEC-3 dev bypass", () => {
  const bypass = { ...env, DEV_AUTH_BYPASS: "1" };

  it("works on localhost", async () => expect((await app.request("http://localhost:8787/api/health", {}, bypass)).status).toBe(200));
  it("does not work on any other host", async () => expect((await app.request("https://x/api/health", {}, bypass)).status).toBe(403));
  it("does not work on 127.0.0.1", async () => expect((await app.request("http://127.0.0.1:8787/api/health", {}, bypass)).status).toBe(403));
});

describe("API-1 health", () => {
  it("returns the health fields", async () => {
    mockFetch(() => new Response("{}"));
    await env.DB.prepare("INSERT INTO poll_error (at, kind, http_status, problem_type) VALUES (5, 'auth', 401, 'api-key-expired')").run();
    const body = await (await get("/api/health", await authedHeaders())).json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(["errors", "key_expires_at", "last_captured_at", "last_poll_at", "last_success_at", "not_before", "open_session", "rate_limit_remaining"]);
    expect(body.errors).toEqual([{ at: 5, kind: "auth", http_status: 401, problem_type: "api-key-expired" }]);
  });
});

describe("API-2 API-3 settings", () => {
  it("changes nothing when one value is invalid", async () => {
    mockFetch(() => new Response("{}"));
    const h = await authedHeaders();
    expect((await send("PUT", "/api/settings", h, { vat_percent: 25, home_lat: 1 })).status).toBe(400);
    const got = await (await get("/api/settings", h)).json<{ values: Record<string, string | null> }>();
    expect(got.values.vat_percent).toBeNull();
  });
  it("updates allowed keys and rejects bad values", async () => {
    mockFetch(() => new Response("{}"));
    const h = await authedHeaders();
    expect((await send("PUT", "/api/settings", h, { vat_percent: 25.5, energy_price_includes_vat: true })).status).toBe(200);
    expect((await send("PUT", "/api/settings", h, { vat_percent: "x" })).status).toBe(400);
    expect((await send("PUT", "/api/settings", h, { home_lat: 1 })).status).toBe(400);
    const got = await (await get("/api/settings", h)).json<{ values: Record<string, string | null>; home_set: boolean; prices_complete: boolean }>();
    expect(got.values.vat_percent).toBe("25.5");
    expect(got.home_set).toBe(false);
    expect(got.prices_complete).toBe(false);
    expect(JSON.stringify(got)).not.toContain("home_lat");
  });
});

describe("HOME-4 POST /setup/home", () => {
  const parked = () => apiResponse({ vehicle: { parkingPosition: { state: "PARKED", gpsCoordinates: HOME } } });

  it("SEC-5 stores the position once and never returns it", async () => {
    mockFetch(parked);
    const h = await authedHeaders();
    const res = await send("POST", "/setup/home", h);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("60.17");
    expect((await loadSettings(env.DB)).homeLat).toBe(HOME.latitude);
    expect((await send("POST", "/setup/home", h)).status).toBe(409);
    expect((await send("POST", "/setup/home?force=1", h)).status).toBe(200);
  });
  it("refuses when the car is moving", async () => {
    mockFetch(() => apiResponse({ vehicle: { parkingPosition: { state: "IN_MOTION" } } }));
    expect((await send("POST", "/setup/home", await authedHeaders())).status).toBe(409);
  });
  it("SEC-2 needs a JSON content type", async () => {
    mockFetch(parked);
    const { "content-type": _dropped, ...h } = await authedHeaders();
    expect((await send("POST", "/setup/home", h)).status).toBe(403);
  });
});
