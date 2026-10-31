import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dueAlerts, runAlerts } from "../src/alerts";
import type { PollStateRow } from "../src/poll";
import { T0, resetDb } from "./helpers";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const DAY = 86400;
const healthy: PollStateRow = {
  last_poll_at: T0,
  last_success_at: T0,
  not_before: null,
  last_captured_at: null,
  last_plug_state: null,
  last_at_home: null,
  key_expires_at: T0 + 30 * DAY,
  rate_limit_remaining: 15,
  auth_failures: 0,
  rate_limit_failures: 0,
};
const keys = (st: PollStateRow) => dueAlerts(st, T0).map((a) => a.key);

describe("dueAlerts", () => {
  it("is quiet when healthy", () => expect(keys(healthy)).toEqual([]));
  it("ALERT-1 warns 14 days before key expiry", () => expect(keys({ ...healthy, key_expires_at: T0 + 14 * DAY })).toEqual(["key_expiring"]));
  it("ALERT-2 warns on repeated auth failures", () => expect(keys({ ...healthy, auth_failures: 3 })).toEqual(["auth_failing"]));
  it("ALERT-3 warns on repeated rate limits", () => expect(keys({ ...healthy, rate_limit_failures: 3 })).toEqual(["rate_limited"]));
  it("ALERT-4 warns after six silent hours", () => expect(keys({ ...healthy, last_success_at: T0 - 6 * 3600 - 1 })).toEqual(["no_success"]));
});

describe("runAlerts", () => {
  const withWebhook = { ...env, ALERT_WEBHOOK_URL: "https://ntfy.sh/test-topic" } as Env;

  beforeEach(() => env.DB.prepare("UPDATE poll_state SET key_expires_at = ?").bind(T0 + DAY).run());

  it("ALERT-6 does nothing without a webhook", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    await runAlerts({ ...env, ALERT_WEBHOOK_URL: "" } as Env, T0);
    expect(f).not.toHaveBeenCalled();
  });
  it("ALERT-5 sends once a day", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok"));
    await runAlerts(withWebhook, T0);
    await runAlerts(withWebhook, T0 + 60);
    expect(f).toHaveBeenCalledTimes(1);
    await runAlerts(withWebhook, T0 + DAY);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("ALERT-5 retries after a failed send", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 500 }));
    await runAlerts(withWebhook, T0);
    await runAlerts(withWebhook, T0 + 60);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
