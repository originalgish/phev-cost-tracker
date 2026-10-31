export type Prices = {
  energyC: number;
  energyIncludesVat: boolean;
  transferC: number;
  transferIncludesVat: boolean;
  taxC: number;
  taxIncludesVat: boolean;
  vatPercent: number;
};

export type EnergySource = "power" | "soc";

export type EnergyChoice = { kwh: number; source: EnergySource } | null;

export type Cost = { energyC: number; transferC: number; taxC: number; totalC: number };

export function kwhBySoc(startSoc: number | null, endSoc: number | null, batteryUsableKwh: number): number | null {
  if (startSoc === null || endSoc === null) return null;
  return (Math.max(0, endSoc - startSoc) / 100) * batteryUsableKwh;
}

// The power estimate is only used when every interval was integrated.
export function chooseEnergy(kwhByPower: number, gapCount: number, bySoc: number | null, preferred: EnergySource): EnergyChoice {
  const powerUsable = gapCount === 0 && kwhByPower > 0;
  if (preferred === "power" && powerUsable) return { kwh: kwhByPower, source: "power" };
  if (bySoc !== null) return { kwh: bySoc, source: "soc" };
  return powerUsable ? { kwh: kwhByPower, source: "power" } : null;
}

export function sessionCost(kwh: number, p: Prices): Cost {
  const withVat = (c: number, included: boolean) => (included ? c : c * (1 + p.vatPercent / 100));
  const energyC = kwh * withVat(p.energyC, p.energyIncludesVat);
  const transferC = kwh * withVat(p.transferC, p.transferIncludesVat);
  const taxC = kwh * withVat(p.taxC, p.taxIncludesVat);
  return { energyC, transferC, taxC, totalC: energyC + transferC + taxC };
}
