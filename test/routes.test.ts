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

describe("SEC-2 cross-site requests", () => {
  const body = { vat_percent: 1 };

  it("rejects JSON from another origin", async () => {
    mockFetch(() => new Response("{}"));
    const res = await send("PUT", "/api/settings", { ...(await authedHeaders()), Origin: "https://evil.example" }, body);
    expect(res.status).toBe(403);
    expect((await loadSettings(env.DB)).prices).toBeNull();
    expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'vat_percent'").first()).toBeNull();
  });
  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"])("rejects %s from the same origin", async (type) => {
    mockFetch(() => new Response("{}"));
    const res = await send("PUT", "/api/settings", { ...(await authedHeaders()), "content-type": type, Origin: "https://x" }, body);
    expect(res.status).toBe(403);
  });
  it("accepts JSON from the same origin", async () => {
    mockFetch(() => new Response("{}"));
    expect((await send("PUT", "/api/settings", { ...(await authedHeaders()), Origin: "https://x" }, body)).status).toBe(200);
  });
});

describe("API-1 health", () => {
  it("returns the 10 most recent errors, newest first", async () => {
    await env.DB.batch(Array.from({ length: 11 }, (_, i) => env.DB.prepare("INSERT INTO poll_error (at, kind) VALUES (?, 'server')").bind(i + 1)));
    mockFetch(() => new Response("{}"));
    const body = await (await get("/api/health", await authedHeaders())).json<{ errors: { at: number }[] }>();
    expect(body.errors.map((e) => e.at)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  });
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
  it("rejects a key inherited from Object.prototype", async () => {
    mockFetch(() => new Response("{}"));
    const h = await authedHeaders();
    for (const key of ["toString", "constructor", "hasOwnProperty"]) {
      expect((await send("PUT", "/api/settings", h, { [key]: 1 })).status).toBe(400);
    }
    expect(await env.DB.prepare("SELECT key FROM settings WHERE key IN ('toString', 'constructor', 'hasOwnProperty')").first()).toBeNull();
  });
  it("rejects a body that is not an object", async () => {
    mockFetch(() => new Response("{}"));
    expect((await send("PUT", "/api/settings", await authedHeaders(), [])).status).toBe(400);
  });
});

describe("HOME-4 POST /setup/home", () => {
  const parked = () => apiResponse({ vehicle: { parkingPosition: { state: "PARKED", gpsCoordinates: HOME } } });
  const apiCalls = (f: ReturnType<typeof mockFetch>) => f.mock.calls.filter(([url]) => String(url).includes("skoda-auto")).length;

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
  it("survives a 200 with no vehicle", async () => {
    mockFetch(() => apiResponse({ errors: [{ type: "VEHICLE_UNAVAILABLE" }] }));
    expect((await send("POST", "/setup/home", await authedHeaders())).status).toBe(409);
  });
  it("spends one API request", async () => {
    const f = mockFetch(parked);
    await send("POST", "/setup/home", await authedHeaders());
    expect(apiCalls(f)).toBe(1);
  });
  it("makes no API call while polling is paused", async () => {
    await env.DB.prepare("UPDATE poll_state SET not_before = ?").bind(Math.floor(Date.now() / 1000) + 3600).run();
    const f = mockFetch(parked);
    expect((await send("POST", "/setup/home", await authedHeaders())).status).toBe(409);
    expect(apiCalls(f)).toBe(0);
  });
  it("POLL-9 POLL-10 handles a good response like a poll", async () => {
    await env.DB.prepare("UPDATE poll_state SET auth_failures = 2, rate_limit_failures = 2").run();
    mockFetch(parked);
    await send("POST", "/setup/home", await authedHeaders());
    const state = await env.DB.prepare("SELECT rate_limit_remaining, auth_failures, rate_limit_failures, last_poll_at FROM poll_state").first();
    expect(state).toEqual({ rate_limit_remaining: 15, auth_failures: 0, rate_limit_failures: 0, last_poll_at: null });
  });
  it("POLL-10 records a response that has no parked position", async () => {
    mockFetch(() => apiResponse({ vehicle: { parkingPosition: { state: "IN_MOTION" } } }));
    await send("POST", "/setup/home", await authedHeaders());
    expect(await env.DB.prepare("SELECT rate_limit_remaining FROM poll_state").first()).toEqual({ rate_limit_remaining: 15 });
  });
  it("POLL-6 POLL-8 handles a 429 like a poll", async () => {
    mockFetch(() => new Response("{}", { status: 429, headers: { "Retry-After": "600" } }));
    const before = Math.floor(Date.now() / 1000);
    expect((await send("POST", "/setup/home", await authedHeaders())).status).toBe(502);
    expect(await env.DB.prepare("SELECT kind, http_status FROM poll_error").first()).toEqual({ kind: "rate_limit", http_status: 429 });
    const state = await env.DB.prepare("SELECT not_before, rate_limit_failures FROM poll_state").first<{ not_before: number; rate_limit_failures: number }>();
    expect(state?.not_before).toBeGreaterThanOrEqual(before + 600);
    expect(state?.rate_limit_failures).toBe(1);
  });
  it("SEC-2 needs a JSON content type", async () => {
    mockFetch(parked);
    const { "content-type": _dropped, ...h } = await authedHeaders();
    expect((await send("POST", "/setup/home", h)).status).toBe(403);
  });
});
