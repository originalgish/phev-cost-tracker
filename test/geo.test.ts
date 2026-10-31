import { expect, it } from "vitest";
import { distanceM } from "../src/geo";

it("HOME-1 measures short distances", () => {
  const d = distanceM({ latitude: 60.17, longitude: 24.94 }, { latitude: 60.1704, longitude: 24.94 });
  expect(d).toBeGreaterThan(44);
  expect(d).toBeLessThan(45);
});

it("HOME-1 is zero for the same point", () => {
  expect(distanceM({ latitude: 60.17, longitude: 24.94 }, { latitude: 60.17, longitude: 24.94 })).toBe(0);
});
