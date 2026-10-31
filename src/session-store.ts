import type { Sample } from "./sample";
import type { Settings } from "./settings";

// Phase 2 replaces this file. Until then the collector only stores snapshots.
export async function sessionWrites(_db: D1Database, _sample: Sample | null, _nowSec: number, _s: Settings, _timeZone: string): Promise<D1PreparedStatement[]> {
  return [];
}
