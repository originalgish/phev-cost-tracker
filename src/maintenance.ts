import { MAX_GAP_MIN } from "./config";
import { step, type OpenSession } from "./session";
import { insertClosed, totalsFor } from "./session-store";
import type { Sample } from "./sample";

type SnapshotRow = {
  captured_at: number;
  plug_state: string | null;
  charge_state: string | null;
  charge_power_kw: number | null;
  soc_percent: number | null;
  odometer_km: number | null;
  at_home: number | null;
};

const toSample = (r: SnapshotRow): Sample => ({
  capturedAt: r.captured_at,
  plugState: r.plug_state,
  chargeState: r.charge_state,
  powerKw: r.charge_power_kw,
  socPercent: r.soc_percent,
  odometerKm: r.odometer_km,
  atHome: r.at_home === null ? null : r.at_home === 1,
});

// A range that cuts through a stored session would split it or count it twice, so it grows to whole sessions.
async function wholeSessions(db: D1Database, from: number, to: number): Promise<[number, number]> {
  const crossing = (at: number) => db.prepare("SELECT started_at, ended_at FROM charge_session WHERE started_at < ? AND ended_at >= ?").bind(at, at);
  const [atStart, atEnd] = await db.batch<{ started_at: number; ended_at: number }>([crossing(from), crossing(to)]);
  const first = atStart?.results[0];
  const last = atEnd?.results[0];
  return [first?.started_at ?? from, last === undefined ? to : last.ended_at + 1];
}

// Replays snapshots in [from, to) through the same state machine as the live poll.
// The caller must make sure no session is open.
export async function rebuildSessions(db: D1Database, rangeFrom: number, rangeTo: number, timeZone: string): Promise<number> {
  const [from, to] = await wholeSessions(db, rangeFrom, rangeTo);
  const { results } = await db
    .prepare("SELECT * FROM snapshot WHERE captured_at >= ? AND captured_at < ? ORDER BY captured_at")
    .bind(from, to)
    .all<SnapshotRow>();
  const writes = [db.prepare("DELETE FROM charge_session WHERE started_at >= ? AND started_at < ?").bind(from, to)];
  let current: OpenSession | null = null;
  for (const row of results) {
    const t = step(current, toSample(row), MAX_GAP_MIN * 60);
    if (t.kind === "open" || t.kind === "update") current = t.session;
    if (t.kind === "close") {
      writes.push(insertClosed(db, t.session, t.endedAt, t.reason, timeZone));
      current = null;
    }
  }
  if (current !== null) writes.push(insertClosed(db, current, current.lastSampleAt, "stale", timeZone));
  await db.batch(writes);
  return writes.length - 1;
}

type ClosedRow = { id: number; kwh_by_power: number; gap_count: number; start_soc: number | null; end_soc: number | null };

// Applies the current price and battery size to every closed session.
export async function recomputeCosts(db: D1Database): Promise<number> {
  const { results } = await db.prepare("SELECT id, kwh_by_power, gap_count, start_soc, end_soc FROM charge_session WHERE status = 'closed'").all<ClosedRow>();
  const writes = results.map((r) => {
    const t = totalsFor(r.kwh_by_power, r.gap_count, r.start_soc, r.end_soc);
    return db
      .prepare("UPDATE charge_session SET kwh_by_soc = ?, kwh_used = ?, kwh_source = ?, cost_c = ? WHERE id = ?")
      .bind(t.bySoc, t.kwh, t.source, t.costC, r.id);
  });
  if (writes.length > 0) await db.batch(writes);
  return writes.length;
}
