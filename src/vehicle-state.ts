import type { VehicleResponse } from "./skoda";

type Field = string | number | null;
type Part = { capturedAt: number | null; data: Record<string, Field> };
type Vehicle = NonNullable<VehicleResponse["vehicle"]>;

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function capturedAt(stamp: unknown): number | null {
  const ms = Date.parse(typeof stamp === "string" ? stamp : "");
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function lockState(overall: NonNullable<Vehicle["status"]>["overall"]): string | null {
  const reliable = text(overall?.reliableLockStatus);
  if (reliable !== null && reliable !== "UNKNOWN") return reliable;
  return { YES: "LOCKED", NO: "UNLOCKED" }[overall?.locked ?? ""] ?? null;
}

// Each part lists the fields the dashboard shows and nothing else (SEC-8): never copy a whole part.
const PARTS: Record<string, (v: Vehicle) => Part | null> = {
  charging: ({ charging: c }) => {
    if (c === undefined) return null;
    const rangeM = num(c.status?.battery?.remainingCruisingRangeInMeters);
    return {
      capturedAt: capturedAt(c.carCapturedTimestamp),
      data: {
        state: text(c.status?.state),
        plug_state: text(c.status?.plugConnectionState),
        power_kw: num(c.status?.chargePowerInKw),
        soc_percent: num(c.status?.battery?.stateOfChargeInPercent),
        range_km: rangeM === null ? null : Math.round(rangeM / 1000),
        target_soc_percent: num(c.settings?.targetStateOfChargeInPercent),
        minutes_to_full: num(c.status?.remainingTimeToFullyChargedInMinutes),
      },
    };
  },
  fuelStatus: ({ fuelStatus: f }) => {
    if (f === undefined) return null;
    const fuelEngine = [f.primaryEngineRange, f.secondaryEngineRange].find((e) => e?.engineType !== undefined && e.engineType !== "ELECTRIC");
    return {
      capturedAt: capturedAt(f.carCapturedTimestamp),
      data: { total_range_km: num(f.totalRangeInKm), fuel_percent: num(fuelEngine?.currentFuelLevelInPercent) },
    };
  },
  status: ({ status: s }) => (s === undefined ? null : { capturedAt: capturedAt(s.carCapturedTimestamp), data: { locked: lockState(s.overall) } }),
  airConditioning: ({ airConditioning: a }) =>
    a === undefined
      ? null
      : {
          capturedAt: capturedAt(a.carCapturedTimestamp),
          data: { state: text(a.state), target_temp: num(a.targetTemperature?.value), target_temp_unit: text(a.targetTemperature?.unit) },
        },
  odometer: ({ odometer: o }) => (o === undefined ? null : { capturedAt: capturedAt(o.carCapturedTimestamp), data: { km: num(o.mileageInKm) } }),
};

// POLL-12: a part missing from the response writes nothing, so it keeps its earlier state and time.
export function carStateWrites(db: D1Database, body: VehicleResponse): D1PreparedStatement[] {
  const vehicle = body.vehicle ?? {};
  const writes: D1PreparedStatement[] = [];
  for (const [name, extract] of Object.entries(PARTS)) {
    const part = extract(vehicle);
    if (part === null) continue;
    writes.push(
      db
        .prepare("INSERT INTO vehicle_state (part, captured_at, data) VALUES (?, ?, ?) ON CONFLICT (part) DO UPDATE SET captured_at = excluded.captured_at, data = excluded.data")
        .bind(name, part.capturedAt, JSON.stringify(part.data)),
    );
  }
  return writes;
}
