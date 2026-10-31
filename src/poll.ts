import { POLL_INTERVAL_IDLE_MIN, POLL_INTERVAL_PLUGGED_MIN } from "./config";
import { nextNotBefore, shouldPoll } from "./gate";
import { toSample } from "./sample";
import { sessionWrites } from "./session-store";
import { loadSettings } from "./settings";
import { carStateWrites } from "./vehicle-state";
import { fetchVehicle, typeSlug, type FetchFailure, type RateMeta } from "./skoda";

const POLL_PARTS = ["charging", "fuelStatus", "parkingPosition", "odometer"];
const ERROR_RETENTION_SECONDS = 30 * 86400;

export type PollStateRow = {
  last_poll_at: number | null;
  last_success_at: number | null;
  not_before: number | null;
  last_captured_at: number | null;
  last_plug_state: string | null;
  last_at_home: number | null;
  key_expires_at: number | null;
  rate_limit_remaining: number | null;
  auth_failures: number;
  rate_limit_failures: number;
};

export type PollOutcome = "skipped" | "error" | "partial" | "unchanged" | "stored";

export async function loadPollState(db: D1Database): Promise<PollStateRow> {
  const row = await db.prepare("SELECT * FROM poll_state WHERE id = 1").first<PollStateRow>();
  if (row === null) throw new Error("poll_state row missing");
  return row;
}

function errorWrites(db: D1Database, nowSec: number, kind: string, status: number | null, problemType: string | null): D1PreparedStatement[] {
  return [
    db.prepare("INSERT INTO poll_error (at, kind, http_status, problem_type) VALUES (?, ?, ?, ?)").bind(nowSec, kind, status, problemType),
    db.prepare("DELETE FROM poll_error WHERE at < ?").bind(nowSec - ERROR_RETENTION_SECONDS),
  ];
}

// failureWrites and successWrite cover every API response, including the one from /setup/home.
export function failureWrites(db: D1Database, state: PollStateRow, result: FetchFailure, nowSec: number): D1PreparedStatement[] {
  const { keyExpiresAt, rateRemaining, rateResetSeconds, retryAfterSeconds } = result.meta;
  const authFailures = state.auth_failures + (result.kind === "auth" ? 1 : 0);
  const rateFailures = state.rate_limit_failures + (result.kind === "rate_limit" ? 1 : 0);
  const notBefore = nextNotBefore(nowSec, { failureKind: result.kind, retryAfterSeconds, rateRemaining, rateResetSeconds, authFailures });
  return [
    ...errorWrites(db, nowSec, result.kind, result.status, result.problemType),
    db
      .prepare(
        `UPDATE poll_state SET not_before = ?, auth_failures = ?, rate_limit_failures = ?,
         key_expires_at = COALESCE(?, key_expires_at), rate_limit_remaining = COALESCE(?, rate_limit_remaining) WHERE id = 1`,
      )
      .bind(notBefore, authFailures, rateFailures, keyExpiresAt, rateRemaining),
  ];
}

export function successWrite(db: D1Database, meta: RateMeta, nowSec: number): D1PreparedStatement {
  const { keyExpiresAt, rateRemaining, rateResetSeconds, retryAfterSeconds } = meta;
  const notBefore = nextNotBefore(nowSec, { failureKind: null, retryAfterSeconds, rateRemaining, rateResetSeconds, authFailures: 0 });
  return db
    .prepare(
      `UPDATE poll_state SET not_before = ?, auth_failures = 0, rate_limit_failures = 0,
       key_expires_at = COALESCE(?, key_expires_at), rate_limit_remaining = COALESCE(?, rate_limit_remaining) WHERE id = 1`,
    )
    .bind(notBefore, keyExpiresAt, rateRemaining);
}

export async function pollOnce(env: Env, nowSec: number): Promise<PollOutcome> {
  const db = env.DB;
  const state = await loadPollState(db);
  const settings = await loadSettings(db);
  const due = shouldPoll(nowSec, {
    lastPollAt: state.last_poll_at,
    notBefore: state.not_before,
    lastPlugState: state.last_plug_state,
    pluggedIntervalMin: POLL_INTERVAL_PLUGGED_MIN,
    idleIntervalMin: POLL_INTERVAL_IDLE_MIN,
  });
  if (!due) return "skipped";

  const result = await fetchVehicle(env, POLL_PARTS, nowSec);

  if (!result.ok) {
    await db.batch([
      ...failureWrites(db, state, result, nowSec),
      db.prepare("UPDATE poll_state SET last_poll_at = ? WHERE id = 1").bind(nowSec),
      ...(await sessionWrites(db, null, nowSec, env.TIMEZONE)),
    ]);
    return "error";
  }

  const sample = toSample(result.body, settings, { plugState: state.last_plug_state, atHome: state.last_at_home });
  const isNew = sample !== null && (state.last_captured_at === null || sample.capturedAt > state.last_captured_at);
  const atHome = sample?.atHome == null ? null : Number(sample.atHome);
  // HOME-3 only carries a value across readings that stayed plugged in, so a car seen unplugged or
  // newly plugged in with no position forgets it. A reading with no plug state says nothing either way.
  const lastAtHome = atHome ?? (sample?.plugState == null ? state.last_at_home : null);
  const writes: D1PreparedStatement[] = [];

  if (sample === null) {
    const errors = Array.isArray(result.body.errors) ? result.body.errors : [];
    const kinds = errors.map((e) => typeSlug(e?.type)).join(",") || "missing-charging";
    writes.push(...errorWrites(db, nowSec, "partial", 200, kinds.slice(0, 200)));
  }
  if (sample !== null && isNew) {
    writes.push(
      db
        .prepare("INSERT OR IGNORE INTO snapshot (captured_at, plug_state, charge_state, charge_power_kw, soc_percent, odometer_km, at_home) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(sample.capturedAt, sample.plugState, sample.chargeState, sample.powerKw, sample.socPercent, sample.odometerKm, atHome),
    );
  }
  writes.push(
    ...carStateWrites(db, result.body),
    successWrite(db, result.meta, nowSec),
    db
      .prepare(
        `UPDATE poll_state SET last_poll_at = ?, last_success_at = ?, last_captured_at = COALESCE(?, last_captured_at),
         last_plug_state = COALESCE(?, last_plug_state), last_at_home = ? WHERE id = 1`,
      )
      .bind(nowSec, nowSec, isNew ? sample.capturedAt : null, sample?.plugState ?? null, lastAtHome),
    ...(await sessionWrites(db, isNew ? sample : null, nowSec, env.TIMEZONE)),
  );
  await db.batch(writes);
  if (sample === null) return "partial";
  return isNew ? "stored" : "unchanged";
}
