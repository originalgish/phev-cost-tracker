import type { EnergySource, Prices } from "./cost";

export type Settings = {
  homeLat: number | null;
  homeLon: number | null;
  homeRadiusM: number;
  batteryUsableKwh: number;
  pluggedIntervalMin: number;
  idleIntervalMin: number;
  maxGapMin: number;
  sessionStaleMin: number;
  costEnergySource: EnergySource;
  prices: Prices | null; // null until every price field is filled in
};

type Raw = Record<string, string>;

const num = (raw: Raw, key: string): number | null => {
  const v = raw[key];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const bool = (raw: Raw, key: string): boolean | null => {
  const v = raw[key];
  return v === "true" ? true : v === "false" ? false : null;
};

function readPrices(raw: Raw): Prices | null {
  const energyC = num(raw, "energy_price_c_per_kwh");
  const energyIncludesVat = bool(raw, "energy_price_includes_vat");
  const transferC = num(raw, "transfer_price_c_per_kwh");
  const transferIncludesVat = bool(raw, "transfer_price_includes_vat");
  const taxC = num(raw, "electricity_tax_c_per_kwh");
  const taxIncludesVat = bool(raw, "electricity_tax_includes_vat");
  const vatPercent = num(raw, "vat_percent");
  if (energyC === null || energyIncludesVat === null || transferC === null || transferIncludesVat === null) return null;
  if (taxC === null || taxIncludesVat === null || vatPercent === null) return null;
  return { energyC, energyIncludesVat, transferC, transferIncludesVat, taxC, taxIncludesVat, vatPercent };
}

export function parseSettings(raw: Raw): Settings {
  return {
    homeLat: num(raw, "home_lat"),
    homeLon: num(raw, "home_lon"),
    homeRadiusM: num(raw, "home_radius_m") ?? 50,
    batteryUsableKwh: num(raw, "battery_usable_kwh") ?? 20,
    pluggedIntervalMin: num(raw, "poll_interval_plugged_min") ?? 10,
    idleIntervalMin: num(raw, "poll_interval_idle_min") ?? 15,
    maxGapMin: num(raw, "max_gap_min") ?? 45,
    sessionStaleMin: num(raw, "session_stale_min") ?? 180,
    costEnergySource: raw.cost_energy_source === "soc" ? "soc" : "power",
    prices: readPrices(raw),
  };
}

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return parseSettings(Object.fromEntries(results.map((r) => [r.key, r.value])));
}
