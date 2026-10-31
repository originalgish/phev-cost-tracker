import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVehicle, readMeta } from "../src/skoda";

afterEach(() => vi.restoreAllMocks());

const NOW = Date.parse("2026-10-21T07:28:00Z") / 1000;

describe("readMeta", () => {
  it("POLL-10 reads quota and expiry headers", () => {
    const meta = readMeta(new Headers({ "X-API-Key-Expires-At": "2026-12-01T00:00:00Z", "RateLimit-Remaining": "7", "RateLimit-Reset": "120" }), NOW);
    expect(meta).toEqual({ keyExpiresAt: Date.parse("2026-12-01T00:00:00Z") / 1000, rateRemaining: 7, rateResetSeconds: 120, retryAfterSeconds: null });
  });
  it("POLL-6 accepts Retry-After in seconds", () => expect(readMeta(new Headers({ "Retry-After": "90" }), NOW).retryAfterSeconds).toBe(90));
  it("POLL-6 accepts Retry-After as a date", () => expect(readMeta(new Headers({ "Retry-After": "Wed, 21 Oct 2026 07:28:30 GMT" }), NOW).retryAfterSeconds).toBe(30));
  it("POLL-10 ignores an unparsable expiry", () => expect(readMeta(new Headers({ "X-API-Key-Expires-At": "soon" }), NOW).keyExpiresAt).toBeNull());
});

describe("fetchVehicle", () => {
  const respond = (status: number, body: string) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status }));

  it("POLL-3 sends the key and repeated include params", async () => {
    const f = respond(200, JSON.stringify({ vehicle: {} }));
    const r = await fetchVehicle(env, ["charging", "odometer"], NOW);
    expect(r.ok).toBe(true);
    expect(String(f.mock.calls[0]?.[0])).toContain("?include=charging&include=odometer");
  });
  it("SEC-4 keeps only the problem slug", async () => {
    respond(401, JSON.stringify({ type: "https://public.api.connect.skoda-auto.cz/problems/api-key-expired", instance: "/api/v1/vehicles/SECRETVIN" }));
    const r = await fetchVehicle(env, ["charging"], NOW);
    expect(r).toMatchObject({ ok: false, kind: "auth", status: 401, problemType: "api-key-expired" });
    expect(JSON.stringify(r)).not.toContain("SECRETVIN");
  });
  it("POLL-8 classifies 403, 429 and 5xx", async () => {
    for (const [status, kind] of [[403, "auth"], [429, "rate_limit"], [503, "server"]] as const) {
      respond(status, "{}");
      expect(await fetchVehicle(env, ["charging"], NOW)).toMatchObject({ ok: false, kind });
      vi.restoreAllMocks();
    }
  });
  it("POLL-8 survives a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    expect(await fetchVehicle(env, ["charging"], NOW)).toMatchObject({ ok: false, kind: "network", status: null });
  });
  it("POLL-8 treats invalid JSON as a server error", async () => {
    respond(200, "not json");
    expect(await fetchVehicle(env, ["charging"], NOW)).toMatchObject({ ok: false, kind: "server", problemType: "invalid-json" });
  });
});
