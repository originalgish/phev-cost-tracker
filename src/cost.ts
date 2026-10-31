import { ENERGY_PRICE_C_PER_KWH } from "./config";

export type EnergySource = "power" | "soc";

export type EnergyChoice = { kwh: number; source: EnergySource } | null;

export function kwhBySoc(startSoc: number | null, endSoc: number | null, batteryUsableKwh: number): number | null {
  if (startSoc === null || endSoc === null) return null;
  return (Math.max(0, endSoc - startSoc) / 100) * batteryUsableKwh;
}

// The power estimate is only used when every interval was integrated.
export function chooseEnergy(kwhByPower: number, gapCount: number, bySoc: number | null): EnergyChoice {
  if (gapCount === 0 && kwhByPower > 0) return { kwh: kwhByPower, source: "power" };
  if (bySoc !== null) return { kwh: bySoc, source: "soc" };
  return null;
}

export const sessionCostC = (kwh: number): number => kwh * ENERGY_PRICE_C_PER_KWH;
