import { describe, expect, it } from "vitest";
import { chooseEnergy, kwhBySoc, sessionCostC } from "../src/cost";

describe("COST-1 sessionCostC", () => {
  it("multiplies billed kWh by the contract price", () => expect(sessionCostC(10)).toBeCloseTo(78.7));
  it("is zero for no energy", () => expect(sessionCostC(0)).toBe(0));
});

describe("SES-9 kwhBySoc", () => {
  it("scales by usable capacity", () => expect(kwhBySoc(20, 80, 20)).toBeCloseTo(12));
  it("is null when a reading is missing", () => expect(kwhBySoc(null, 80, 20)).toBeNull());
  it("never goes negative", () => expect(kwhBySoc(80, 70, 20)).toBe(0));
});

describe("COST-2 chooseEnergy", () => {
  it("uses power when it has no gaps", () => expect(chooseEnergy(5, 0, 6)).toEqual({ kwh: 5, source: "power" }));
  it("falls back to SoC when power has gaps", () => expect(chooseEnergy(5, 1, 6)).toEqual({ kwh: 6, source: "soc" }));
  it("falls back to SoC when power is zero", () => expect(chooseEnergy(0, 0, 6)).toEqual({ kwh: 6, source: "soc" }));
  it("falls back to power when SoC is missing", () => expect(chooseEnergy(5, 0, null)).toEqual({ kwh: 5, source: "power" }));
  it("gives nothing when neither is usable", () => expect(chooseEnergy(0, 0, null)).toBeNull());
});
