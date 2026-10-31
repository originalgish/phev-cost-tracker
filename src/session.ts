import type { Sample } from "./sample";

export type OpenSession = {
  startedAt: number;
  startSoc: number | null;
  endSoc: number | null;
  lastSampleAt: number;
  lastPowerKw: number | null;
  kwhByPower: number;
  gapCount: number;
};

export type EndReason = "unplugged" | "charge_ended" | "stale";

export type Transition =
  | { kind: "none" }
  | { kind: "open"; session: OpenSession }
  | { kind: "update"; session: OpenSession }
  | { kind: "close"; session: OpenSession; endedAt: number; reason: EndReason };

// Any other value, including an omitted state or one Škoda adds later, keeps the session open.
const CLOSING_STATES = new Set(["CONNECT_CABLE", "CONSERVING", "READY_FOR_CHARGING", "DISCHARGING", "CHARGING_INTERRUPTED"]);

function highestSoc(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function advance(open: OpenSession, at: number, powerKw: number | null, soc: number | null, maxGapSeconds: number): OpenSession {
  const dt = at - open.lastSampleAt;
  let kwhByPower = open.kwhByPower;
  let gapCount = open.gapCount;
  if (dt > maxGapSeconds || open.lastPowerKw === null || powerKw === null) {
    gapCount += 1;
  } else {
    kwhByPower += ((open.lastPowerKw + powerKw) / 2) * (dt / 3600);
  }
  return {
    ...open,
    startSoc: open.startSoc ?? soc,
    endSoc: highestSoc(open.endSoc, soc),
    lastSampleAt: at,
    lastPowerKw: powerKw,
    kwhByPower,
    gapCount,
  };
}

export function step(open: OpenSession | null, s: Sample, maxGapSeconds: number): Transition {
  if (open === null) {
    if (s.plugState !== "CONNECTED" || s.chargeState !== "CHARGING" || s.atHome !== true) return { kind: "none" };
    return {
      kind: "open",
      session: {
        startedAt: s.capturedAt,
        startSoc: s.socPercent,
        endSoc: s.socPercent,
        lastSampleAt: s.capturedAt,
        lastPowerKw: s.powerKw,
        kwhByPower: 0,
        gapCount: 0,
      },
    };
  }
  if (s.capturedAt <= open.lastSampleAt) return { kind: "none" };

  const unplugged = s.plugState === "DISCONNECTED";
  const ended = s.chargeState !== null && CLOSING_STATES.has(s.chargeState);
  if (unplugged || ended) {
    return {
      kind: "close",
      session: advance(open, s.capturedAt, 0, s.socPercent, maxGapSeconds),
      endedAt: s.capturedAt,
      reason: unplugged ? "unplugged" : "charge_ended",
    };
  }
  return { kind: "update", session: advance(open, s.capturedAt, s.powerKw, s.socPercent, maxGapSeconds) };
}

export function closeIfStale(open: OpenSession, nowSec: number, staleSeconds: number): Transition {
  if (nowSec - open.lastSampleAt <= staleSeconds) return { kind: "none" };
  return { kind: "close", session: open, endedAt: open.lastSampleAt, reason: "stale" };
}
