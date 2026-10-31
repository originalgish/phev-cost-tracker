const BASE = "https://public.api.connect.skoda-auto.cz/api/v1/vehicles";
const TIMEOUT_MS = 20_000;

export type ParkingPosition = {
  state: string;
  gpsCoordinates?: { latitude: number; longitude: number };
};

export type EngineRange = { engineType?: string; currentFuelLevelInPercent?: number };

export type VehicleResponse = {
  vehicle?: {
    parkingPosition?: ParkingPosition;
    odometer?: { carCapturedTimestamp?: string; mileageInKm?: number };
    charging?: {
      carCapturedTimestamp?: string;
      settings?: { targetStateOfChargeInPercent?: number };
      status?: {
        state?: string;
        plugConnectionState?: string;
        chargePowerInKw?: number;
        remainingTimeToFullyChargedInMinutes?: number;
        battery?: { stateOfChargeInPercent?: number; remainingCruisingRangeInMeters?: number };
      };
    };
    fuelStatus?: {
      carCapturedTimestamp?: string;
      totalRangeInKm?: number;
      primaryEngineRange?: EngineRange;
      secondaryEngineRange?: EngineRange;
    };
    status?: { carCapturedTimestamp?: string; overall?: { locked?: string; reliableLockStatus?: string } };
    airConditioning?: {
      carCapturedTimestamp?: string;
      state?: string;
      targetTemperature?: { value?: number; unit?: string };
    };
  };
  errors?: { type: string }[];
};

export type RateMeta = {
  keyExpiresAt: number | null; // unix seconds
  rateRemaining: number | null;
  rateResetSeconds: number | null;
  retryAfterSeconds: number | null;
};

export type ErrorKind = "auth" | "rate_limit" | "server" | "network";

export type FetchResult =
  | { ok: true; body: VehicleResponse; meta: RateMeta }
  | { ok: false; kind: ErrorKind; status: number | null; problemType: string | null; meta: RateMeta };

export type FetchFailure = Extract<FetchResult, { ok: false }>;

const EMPTY_META: RateMeta = { keyExpiresAt: null, rateRemaining: null, rateResetSeconds: null, retryAfterSeconds: null };

function intHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

function epochHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export function readMeta(headers: Headers, nowSec: number): RateMeta {
  const retryDate = intHeader(headers, "Retry-After") === null ? epochHeader(headers, "Retry-After") : null;
  return {
    keyExpiresAt: epochHeader(headers, "X-API-Key-Expires-At"),
    rateRemaining: intHeader(headers, "RateLimit-Remaining"),
    rateResetSeconds: intHeader(headers, "RateLimit-Reset"),
    retryAfterSeconds: intHeader(headers, "Retry-After") ?? (retryDate === null ? null : Math.max(0, retryDate - nowSec)),
  };
}

function classify(status: number): ErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  return "server";
}

// Only the slug of the problem type is kept: `detail` and `instance` can carry the VIN.
async function problemSlug(res: Response): Promise<string | null> {
  try {
    const body = await res.json<{ type?: unknown }>();
    return typeof body.type === "string" ? (body.type.split("/").pop() ?? null) : null;
  } catch {
    return null;
  }
}

export async function fetchVehicle(env: Env, parts: string[], nowSec: number): Promise<FetchResult> {
  const query = parts.map((p) => `include=${p}`).join("&");
  let res: Response;
  try {
    res = await fetch(`${BASE}/${env.SKODA_VIN}?${query}`, {
      headers: { "X-API-Key": env.SKODA_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, kind: "network", status: null, problemType: null, meta: EMPTY_META };
  }
  const meta = readMeta(res.headers, nowSec);
  if (!res.ok) {
    return { ok: false, kind: classify(res.status), status: res.status, problemType: await problemSlug(res), meta };
  }
  try {
    return { ok: true, body: (await res.json<VehicleResponse | null>()) ?? {}, meta };
  } catch {
    return { ok: false, kind: "server", status: res.status, problemType: "invalid-json", meta };
  }
}
