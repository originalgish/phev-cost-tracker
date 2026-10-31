import { HOME_RADIUS_M } from "./config";
import { distanceM } from "./geo";
import type { Settings } from "./settings";
import type { ParkingPosition, VehicleResponse } from "./skoda";

export type Sample = {
  capturedAt: number; // unix seconds, from charging.carCapturedTimestamp
  plugState: string | null;
  chargeState: string | null;
  powerKw: number | null;
  socPercent: number | null;
  odometerKm: number | null;
  atHome: boolean | null;
};

export type PreviousPlace = { plugState: string | null; atHome: number | null };

export function resolveAtHome(parking: ParkingPosition | undefined, s: Settings, plugState: string | null, prev: PreviousPlace): boolean | null {
  const gps = parking?.gpsCoordinates;
  if (parking?.state === "PARKED" && gps !== undefined && s.homeLat !== null && s.homeLon !== null) {
    return distanceM(gps, { latitude: s.homeLat, longitude: s.homeLon }) <= HOME_RADIUS_M;
  }
  // A car that stayed plugged in cannot have moved.
  if (plugState === "CONNECTED" && prev.plugState === "CONNECTED" && prev.atHome !== null) {
    return prev.atHome === 1;
  }
  return null;
}

export function toSample(body: VehicleResponse, s: Settings, prev: PreviousPlace): Sample | null {
  const charging = body.vehicle?.charging;
  const capturedMs = Date.parse(charging?.carCapturedTimestamp ?? "");
  if (Number.isNaN(capturedMs)) return null;
  const status = charging?.status;
  const plugState = status?.plugConnectionState ?? null;
  return {
    capturedAt: Math.floor(capturedMs / 1000),
    plugState,
    chargeState: status?.state ?? null,
    powerKw: status?.chargePowerInKw ?? null,
    socPercent: status?.battery?.stateOfChargeInPercent ?? null,
    odometerKm: body.vehicle?.odometer?.mileageInKm ?? null,
    atHome: resolveAtHome(body.vehicle?.parkingPosition, s, plugState, prev),
  };
}
