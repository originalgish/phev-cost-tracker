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

describe("DASH-12 render without waiting for scripts", () => {
  it.each(["/", "/health"])("defers every script on %s", async (path) => {
    const scripts = (await page(path)).match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toMatch(/\s(defer\b|type="module")/);
  });
});

describe("DASH-13 page description", () => {
  it.each(["/", "/health"])("has a meta description on %s", async (path) => {
    expect(await page(path)).toMatch(/<meta name="description" content="[^"]+">/);
  });
});

describe("DASH-14 loading placeholder", () => {
  it("starts with a placeholder and the banners and cards hidden", async () => {
    const html = await page("/");
    const content = html.match(/<div id="content"[^>]*>/)?.[0];
    expect(content).toContain("hidden");
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect(at("loading")).toBeGreaterThan(-1);
    expect(at("loading")).toBeLessThan(at("content"));
    expect(at("banners")).toBeGreaterThan(at("content"));
    expect(at("car")).toBeGreaterThan(at("content"));
  });
  it("keeps the error message outside the hidden content, so a failed load can show it", async () => {
    const html = await page("/");
    expect(html.indexOf('id="status"')).toBeLessThan(html.indexOf('id="content"'));
  });
});
