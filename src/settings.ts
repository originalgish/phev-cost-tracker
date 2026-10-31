// The home position is the only stored setting. Everything else is a constant in config.ts.
export type Settings = {
  homeLat: number | null;
  homeLon: number | null;
};

const num = (raw: Record<string, string>, key: string): number | null => {
  const v = raw[key];
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const raw = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { homeLat: num(raw, "home_lat"), homeLon: num(raw, "home_lon") };
}
