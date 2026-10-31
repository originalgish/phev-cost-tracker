import { loadPollState, type PollStateRow } from "./poll";

const DAY = 86400;
const KEY_WARNING_SECONDS = 14 * DAY;
const FAILURE_THRESHOLD = 3;
const SILENCE_SECONDS = 6 * 3600;
const RESEND_SECONDS = DAY;

export type Alert = { key: string; message: string };

export function dueAlerts(st: PollStateRow, nowSec: number): Alert[] {
  const alerts: Alert[] = [];
  if (st.key_expires_at !== null && st.key_expires_at - nowSec <= KEY_WARNING_SECONDS) {
    const days = Math.max(0, Math.ceil((st.key_expires_at - nowSec) / DAY));
    alerts.push({ key: "key_expiring", message: `Škoda API key expires in ${days} day(s). Create a new one in the MyŠkoda app.` });
  }
  if (st.auth_failures >= FAILURE_THRESHOLD) {
    alerts.push({ key: "auth_failing", message: `Škoda API rejected the key ${st.auth_failures} times in a row.` });
  }
  if (st.rate_limit_failures >= FAILURE_THRESHOLD) {
    alerts.push({ key: "rate_limited", message: `Škoda API rate limited ${st.rate_limit_failures} polls in a row.` });
  }
  if (st.last_success_at !== null && nowSec - st.last_success_at > SILENCE_SECONDS) {
    alerts.push({ key: "no_success", message: "No successful Škoda API poll in over 6 hours." });
  }
  return alerts;
}

export async function runAlerts(env: Env, nowSec: number): Promise<void> {
  if (!env.ALERT_WEBHOOK_URL) return;
  const due = dueAlerts(await loadPollState(env.DB), nowSec);
  if (due.length === 0) return;
  const { results } = await env.DB.prepare("SELECT key, last_sent_at FROM alert_log").all<{ key: string; last_sent_at: number }>();
  const sentAt = new Map(results.map((r) => [r.key, r.last_sent_at]));
  for (const alert of due) {
    if (nowSec - (sentAt.get(alert.key) ?? 0) < RESEND_SECONDS) continue;
    const res = await fetch(env.ALERT_WEBHOOK_URL, { method: "POST", body: alert.message, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (res?.ok) {
      await env.DB.prepare("INSERT OR REPLACE INTO alert_log (key, last_sent_at) VALUES (?, ?)").bind(alert.key, nowSec).run();
    }
  }
}
