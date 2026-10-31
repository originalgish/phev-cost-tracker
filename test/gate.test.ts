import { describe, expect, it } from "vitest";
import { nextNotBefore, shouldPoll } from "../src/gate";

const gate = { notBefore: null, pluggedIntervalMin: 10, idleIntervalMin: 15 };
const ok = { failureKind: null, retryAfterSeconds: null, rateRemaining: 10, rateResetSeconds: 100, authFailures: 0 };

describe("POLL-1 shouldPoll", () => {
  it("polls when it has never polled", () => expect(shouldPoll(1000, { ...gate, lastPollAt: null, lastPlugState: null })).toBe(true));
  it("waits 15 minutes when idle, less the tolerance", () => {
    expect(shouldPoll(840, { ...gate, lastPollAt: 0, lastPlugState: "DISCONNECTED" })).toBe(true);
    expect(shouldPoll(839, { ...gate, lastPollAt: 0, lastPlugState: "DISCONNECTED" })).toBe(false);
  });
  it("waits 10 minutes when plugged in", () => expect(shouldPoll(540, { ...gate, lastPollAt: 0, lastPlugState: "CONNECTED" })).toBe(true));
  it("POLL-2 respects not_before", () => expect(shouldPoll(900, { ...gate, notBefore: 901, lastPollAt: 0, lastPlugState: null })).toBe(false));
});

describe("nextNotBefore", () => {
  it("is null when healthy", () => expect(nextNotBefore(100, ok)).toBeNull());
  it("POLL-6 honours Retry-After on 429", () => expect(nextNotBefore(100, { ...ok, failureKind: "rate_limit", retryAfterSeconds: 60 })).toBe(160));
  it("POLL-6 defaults to an hour on 429", () => expect(nextNotBefore(100, { ...ok, failureKind: "rate_limit" })).toBe(3700));
  it("POLL-7 honours Retry-After on 503", () => expect(nextNotBefore(100, { ...ok, failureKind: "server", retryAfterSeconds: 30 })).toBe(130));
  it("POLL-7 backs off after three auth failures", () => {
    expect(nextNotBefore(100, { ...ok, failureKind: "auth", authFailures: 2 })).toBeNull();
    expect(nextNotBefore(100, { ...ok, failureKind: "auth", authFailures: 3 })).toBe(3700);
  });
  it("POLL-7 pauses when the quota is nearly gone", () => expect(nextNotBefore(100, { ...ok, rateRemaining: 1 })).toBe(200));
});
