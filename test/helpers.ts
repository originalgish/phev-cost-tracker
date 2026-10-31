import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { vi } from "vitest";

export const HOME = { latitude: 60.17, longitude: 24.94 };
export const AWAY = { latitude: 61, longitude: 25 };
export const T0 = Date.parse("2026-10-31T21:50:00Z") / 1000;

// D1 data persists across tests in a file, so every test starts from this.
export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM snapshot"),
    env.DB.prepare("DELETE FROM charge_session"),
    env.DB.prepare("DELETE FROM poll_error"),
    env.DB.prepare("DELETE FROM alert_log"),
    env.DB.prepare("DELETE FROM poll_state"),
    env.DB.prepare("INSERT INTO poll_state (id) VALUES (1)"),
    env.DB.prepare(
      "DELETE FROM settings WHERE key IN ('home_lat', 'home_lon', 'vat_percent', 'energy_price_includes_vat', 'transfer_price_includes_vat', 'electricity_tax_includes_vat')",
    ),
    env.DB.prepare("UPDATE settings SET value = '8' WHERE key = 'energy_price_c_per_kwh'"),
  ]);
}

export async function setHomeAndPrices(): Promise<void> {
  const put = (key: string, value: string) => env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(key, value);
  await env.DB.batch([
    put("home_lat", String(HOME.latitude)),
    put("home_lon", String(HOME.longitude)),
    put("vat_percent", "25"),
    put("energy_price_includes_vat", "false"),
    put("transfer_price_includes_vat", "true"),
    put("electricity_tax_includes_vat", "true"),
  ]);
}

export type BodyOptions = { ts: string; state?: string; plug?: string; kw?: number; soc?: number; parking?: unknown };

export function vehicleBody(o: BodyOptions) {
  return {
    vehicle: {
      parkingPosition: o.parking ?? { state: "PARKED", gpsCoordinates: HOME },
      odometer: { mileageInKm: 1000 },
      charging: {
        isVehicleInSavedLocation: false,
        carCapturedTimestamp: o.ts,
        status: {
          state: o.state,
          plugConnectionState: o.plug ?? "CONNECTED",
          chargePowerInKw: o.kw ?? 0,
          battery: { stateOfChargeInPercent: o.soc ?? 20 },
        },
      },
    },
    errors: [],
  };
}

export function apiResponse(body: unknown, init?: ResponseInit): Response {
  const headers = { "RateLimit-Remaining": "15", "RateLimit-Reset": "1800", "X-API-Key-Expires-At": "2026-12-01T00:00:00Z" };
  return new Response(JSON.stringify(body), { headers, ...init });
}

// Serves the bodies in order, one per poll.
export function mockApiSequence(bodies: unknown[]) {
  const queue = [...bodies];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => apiResponse(queue.shift()));
}

const keys = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(keys.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };

export function mintToken(audience: string = env.ACCESS_AUD): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(env.ACCESS_TEAM_DOMAIN)
    .setAudience(audience)
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

// Answers the Access JWKS lookup and passes every other request to `other`.
export function mockFetch(other: () => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).endsWith("/cdn-cgi/access/certs")) {
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
    }
    return other();
  });
}

export async function authedHeaders(): Promise<Record<string, string>> {
  return { "Cf-Access-Jwt-Assertion": await mintToken(), "content-type": "application/json" };
}
