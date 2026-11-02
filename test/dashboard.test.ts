import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const page = async (path: string) => (await env.ASSETS.fetch(`https://x${path}`)).text();

describe("DASH-6 data health page", () => {
  it("shows data health at /health", async () => {
    expect((await env.ASSETS.fetch("https://x/health")).status).toBe(200);
    const html = await page("/health");
    expect(html).toContain('id="h-last-poll"');
    expect(html).toContain('id="errors"');
  });
  it("links to it from the dashboard instead of showing it there", async () => {
    const html = await page("/");
    expect(html).toContain('href="/health"');
    expect(html).not.toContain('id="h-last-poll"');
    expect(html).not.toContain('id="errors"');
  });
});

describe("DASH-8 actions", () => {
  it("leaves the rare maintenance actions off the dashboard", async () => {
    const html = await page("/");
    expect(html).not.toContain("Recompute all costs");
    expect(html).not.toContain("Capture home position");
  });
});

describe("DASH-5 charging now", () => {
  it("has a charging-now line outside the month details, so it shows with no months", async () => {
    const html = await page("/");
    const line = html.indexOf('id="charging-now"');
    expect(line).toBeGreaterThan(-1);
    expect(line).toBeLessThan(html.indexOf('id="month-details"'));
  });
});
