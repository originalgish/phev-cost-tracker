import { describe, expect, it } from "vitest";
import { closeIfStale, step, type OpenSession } from "../src/session";
import type { Sample } from "../src/sample";

const GAP = 45 * 60;
const sample = (over: Partial<Sample>): Sample => ({
  capturedAt: 0,
  plugState: "CONNECTED",
  chargeState: "CHARGING",
  powerKw: 3.6,
  socPercent: 20,
  odometerKm: null,
  atHome: true,
  ...over,
});
const open: OpenSession = { startedAt: 0, startSoc: 20, endSoc: 20, lastSampleAt: 0, lastPowerKw: 3.6, kwhByPower: 0, gapCount: 0 };

function closeOf(t: ReturnType<typeof step>) {
  if (t.kind !== "close") throw new Error(`expected close, got ${t.kind}`);
  return t;
}
function updateOf(t: ReturnType<typeof step>) {
  if (t.kind !== "update") throw new Error(`expected update, got ${t.kind}`);
  return t.session;
}

describe("SES-1 opening", () => {
  it("opens when plugged in, charging and at home", () => expect(step(null, sample({}), GAP).kind).toBe("open"));
  it.each([
    [{ atHome: false }],
    [{ atHome: null }],
    [{ chargeState: null }],
    [{ plugState: "DISCONNECTED" }],
    [{ chargeState: "READY_FOR_CHARGING" }],
  ])("stays closed for %j", (over) => expect(step(null, sample(over), GAP).kind).toBe("none"));
});

describe("energy", () => {
  it("SES-7 integrates power over time", () => {
    const s = updateOf(step(open, sample({ capturedAt: 600, socPercent: 23 }), GAP));
    expect(s.kwhByPower).toBeCloseTo(0.6, 6);
    expect(s.endSoc).toBe(23);
  });
  it("SES-7 uses the trapezoid rule", () => {
    expect(updateOf(step(open, sample({ capturedAt: 600, powerKw: 1.8 }), GAP)).kwhByPower).toBeCloseTo(0.45, 6);
  });
  it("SES-3 SES-7 ramps the closing interval to zero", () => {
    const t = closeOf(step(open, sample({ capturedAt: 600, chargeState: "READY_FOR_CHARGING", powerKw: 0 }), GAP));
    expect(t.session.kwhByPower).toBeCloseTo(0.3, 6);
    expect(t.reason).toBe("charge_ended");
  });
  it("SES-8 counts a long interval as a gap", () => {
    const s = updateOf(step(open, sample({ capturedAt: GAP + 1 }), GAP));
    expect(s.gapCount).toBe(1);
    expect(s.kwhByPower).toBe(0);
  });
  it("SES-8 counts a missing power reading as a gap", () => {
    expect(updateOf(step(open, sample({ capturedAt: 600, powerKw: null }), GAP)).gapCount).toBe(1);
  });
  it("SES-9 fills a missing start SoC from the first reading", () => {
    expect(updateOf(step({ ...open, startSoc: null, endSoc: null }, sample({ capturedAt: 600, socPercent: 25 }), GAP)).startSoc).toBe(25);
  });
});

describe("closing", () => {
  it.each(["CONNECT_CABLE", "CONSERVING", "READY_FOR_CHARGING", "DISCHARGING", "CHARGING_INTERRUPTED"])("SES-3 closes on %s", (chargeState) => {
    expect(step(open, sample({ capturedAt: 600, chargeState }), GAP).kind).toBe("close");
  });
  it("SES-4 holds on an omitted state", () => expect(step(open, sample({ capturedAt: 600, chargeState: null }), GAP).kind).toBe("update"));
  it("SES-4 holds on a state it does not recognise", () => expect(step(open, sample({ capturedAt: 600, chargeState: "NEW_VALUE" }), GAP).kind).toBe("update"));
  it("SES-2 SES-9 closes on unplug and keeps the highest SoC", () => {
    const t = closeOf(step({ ...open, endSoc: 80 }, sample({ capturedAt: 600, plugState: "DISCONNECTED", chargeState: "CONNECT_CABLE", socPercent: 75 }), GAP));
    expect(t.session.endSoc).toBe(80);
    expect(t.reason).toBe("unplugged");
  });
  it("SES-6 ignores samples that are not newer", () => expect(step({ ...open, lastSampleAt: 600 }, sample({ capturedAt: 600 }), GAP).kind).toBe("none"));
});

describe("SES-5 closeIfStale", () => {
  it("leaves a recent session open", () => expect(closeIfStale(open, 100, 180).kind).toBe("none"));
  it("closes at the last sample", () => {
    const t = closeOf(closeIfStale(open, 181, 180));
    expect(t.endedAt).toBe(0);
    expect(t.reason).toBe("stale");
  });
});
