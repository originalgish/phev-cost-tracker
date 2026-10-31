export type GateInput = {
  lastPollAt: number | null;
  notBefore: number | null;
  lastPlugState: string | null;
  pluggedIntervalMin: number;
  idleIntervalMin: number;
};

export type BackoffInput = {
  failureKind: string | null;
  retryAfterSeconds: number | null;
  rateRemaining: number | null;
  rateResetSeconds: number | null;
  authFailures: number;
};

// Cron timing is best-effort, so a tick up to a minute early still counts.
const EARLY_TOLERANCE_SECONDS = 60;
const AUTH_FAILURE_LIMIT = 3;
const AUTH_BACKOFF_SECONDS = 3600;
const DEFAULT_RATE_LIMIT_BACKOFF_SECONDS = 3600;

export function shouldPoll(nowSec: number, g: GateInput): boolean {
  if (g.notBefore !== null && nowSec < g.notBefore) return false;
  if (g.lastPollAt === null) return true;
  const minutes = g.lastPlugState === "CONNECTED" ? g.pluggedIntervalMin : g.idleIntervalMin;
  return nowSec - g.lastPollAt >= minutes * 60 - EARLY_TOLERANCE_SECONDS;
}

export function nextNotBefore(nowSec: number, b: BackoffInput): number | null {
  // Several reasons can apply at once, so the longest pause wins.
  const waits: number[] = [];
  if (b.failureKind === "rate_limit") waits.push(b.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_BACKOFF_SECONDS);
  else if (b.failureKind !== null && b.retryAfterSeconds !== null) waits.push(b.retryAfterSeconds);
  if (b.failureKind === "auth" && b.authFailures >= AUTH_FAILURE_LIMIT) waits.push(AUTH_BACKOFF_SECONDS);
  if (b.rateRemaining !== null && b.rateRemaining <= 1 && b.rateResetSeconds !== null) waits.push(b.rateResetSeconds);
  return waits.length === 0 ? null : nowSec + Math.max(...waits);
}
