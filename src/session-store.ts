import { BATTERY_USABLE_KWH, MAX_GAP_MIN, SESSION_STALE_MIN } from "./config";
import { chooseEnergy, kwhBySoc, sessionCostC, type EnergySource } from "./cost";
import type { Sample } from "./sample";
import { closeIfStale, step, type EndReason, type OpenSession, type Transition } from "./session";

export type SessionRow = {
  id: number;
  started_at: number;
  start_soc: number | null;
  end_soc: number | null;
  last_sample_at: number;
  last_power_kw: number | null;
  kwh_by_power: number;
  gap_count: number;
};

export const fromRow = (r: SessionRow): OpenSession => ({
  startedAt: r.started_at,
  startSoc: r.start_soc,
  endSoc: r.end_soc,
  lastSampleAt: r.last_sample_at,
  lastPowerKw: r.last_power_kw,
  kwhByPower: r.kwh_by_power,
  gapCount: r.gap_count,
});

export function localMonth(epochSec: number, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit" }).format(new Date(epochSec * 1000));
}

export type Totals = { bySoc: number | null; kwh: number | null; source: EnergySource | null; costC: number | null };

export function totalsFor(kwhByPower: number, gapCount: number, startSoc: number | null, endSoc: number | null): Totals {
  const bySoc = kwhBySoc(startSoc, endSoc, BATTERY_USABLE_KWH);
  const choice = chooseEnergy(kwhByPower, gapCount, bySoc);
  return { bySoc, kwh: choice?.kwh ?? null, source: choice?.source ?? null, costC: choice === null ? null : sessionCostC(choice.kwh) };
}

function closeValues(o: OpenSession): (number | string | null)[] {
  const t = totalsFor(o.kwhByPower, o.gapCount, o.startSoc, o.endSoc);
  return [o.startSoc, o.endSoc, o.lastSampleAt, o.lastPowerKw, o.kwhByPower, o.gapCount, t.bySoc, t.kwh, t.source, t.costC];
}

export function insertClosed(db: D1Database, o: OpenSession, endedAt: number, reason: EndReason, timeZone: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO charge_session (status, started_at, ended_at, end_reason, local_month, start_soc, end_soc, last_sample_at, last_power_kw,
       kwh_by_power, gap_count, kwh_by_soc, kwh_used, kwh_source, cost_c)
       VALUES ('closed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(o.startedAt, endedAt, reason, localMonth(o.startedAt, timeZone), ...closeValues(o));
}

function transitionStatement(db: D1Database, t: Transition, rowId: number | null, timeZone: string): D1PreparedStatement | null {
  if (t.kind === "none") return null;
  const o = t.session;
  if (t.kind === "open") {
    return db
      .prepare("INSERT INTO charge_session (status, started_at, local_month, start_soc, end_soc, last_sample_at, last_power_kw) VALUES ('open', ?, ?, ?, ?, ?, ?)")
      .bind(o.startedAt, localMonth(o.startedAt, timeZone), o.startSoc, o.endSoc, o.lastSampleAt, o.lastPowerKw);
  }
  if (t.kind === "update") {
    return db
      .prepare("UPDATE charge_session SET start_soc = ?, end_soc = ?, last_sample_at = ?, last_power_kw = ?, kwh_by_power = ?, gap_count = ? WHERE id = ?")
      .bind(o.startSoc, o.endSoc, o.lastSampleAt, o.lastPowerKw, o.kwhByPower, o.gapCount, rowId);
  }
  return db
    .prepare(
      `UPDATE charge_session SET status = 'closed', ended_at = ?, end_reason = ?, start_soc = ?, end_soc = ?, last_sample_at = ?, last_power_kw = ?,
       kwh_by_power = ?, gap_count = ?, kwh_by_soc = ?, kwh_used = ?, kwh_source = ?,
       cost_c = ? WHERE id = ?`,
    )
    .bind(t.endedAt, t.reason, ...closeValues(o), rowId);
}

// `sample` is null when the car sent nothing new: then only a stale session can change.
export async function sessionWrites(db: D1Database, sample: Sample | null, nowSec: number, timeZone: string): Promise<D1PreparedStatement[]> {
  const row = await db.prepare("SELECT * FROM charge_session WHERE status = 'open'").first<SessionRow>();
  const open = row === null ? null : fromRow(row);
  let transition: Transition = { kind: "none" };
  if (sample !== null) transition = step(open, sample, MAX_GAP_MIN * 60);
  else if (open !== null) transition = closeIfStale(open, nowSec, SESSION_STALE_MIN * 60);
  const stmt = transitionStatement(db, transition, row?.id ?? null, timeZone);
  return stmt === null ? [] : [stmt];
}
