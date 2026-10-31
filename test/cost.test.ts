import { describe, expect, it } from "vitest";
import { chooseEnergy, kwhBySoc, sessionCost } from "../src/cost";

describe("COST-1 sessionCost", () => {
  it("adds VAT only to components that exclude it", () => {
    const cost = sessionCost(10, {
      energyC: 8,
      energyIncludesVat: false,
      transferC: 5,
      transferIncludesVat: true,
      taxC: 2,
      taxIncludesVat: false,
      vatPercent: 25,
    });
    expect(cost.energyC).toBeCloseTo(100);
    expect(cost.transferC).toBeCloseTo(50);
    expect(cost.taxC).toBeCloseTo(25);
    expect(cost.totalC).toBeCloseTo(175);
  });
});

describe("SES-9 kwhBySoc", () => {
  it("scales by usable capacity", () => expect(kwhBySoc(20, 80, 20)).toBeCloseTo(12));
  it("is null when a reading is missing", () => expect(kwhBySoc(null, 80, 20)).toBeNull());
  it("never goes negative", () => expect(kwhBySoc(80, 70, 20)).toBe(0));
});

describe("COST-2 chooseEnergy", () => {
  it("uses power when it has no gaps", () => expect(chooseEnergy(5, 0, 6, "power")).toEqual({ kwh: 5, source: "power" }));
  it("falls back to SoC when power has gaps", () => expect(chooseEnergy(5, 1, 6, "power")).toEqual({ kwh: 6, source: "soc" }));
  it("honours a SoC preference", () => expect(chooseEnergy(5, 0, 6, "soc")).toEqual({ kwh: 6, source: "soc" }));
  it("falls back to power when SoC is missing", () => expect(chooseEnergy(5, 0, null, "soc")).toEqual({ kwh: 5, source: "power" }));
  it("gives nothing when neither is usable", () => expect(chooseEnergy(0, 0, null, "power")).toBeNull());
});
