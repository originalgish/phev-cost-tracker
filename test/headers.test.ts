import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("SEC-9 page headers", () => {
  it.each(["/", "/app.js", "/style.css", "/vendor/chart.umd.min.js"])("protects %s", async (path) => {
    const res = await env.ASSETS.fetch(`https://x${path}`);
    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
