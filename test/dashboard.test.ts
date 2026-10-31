import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const page = async (path: string) => (await env.ASSETS.fetch(`https://x${path}`)).text();

describe("DASH-8 actions", () => {
  it("leaves the rare maintenance actions off the dashboard", async () => {
    const html = await page("/");
    expect(html).not.toContain("Recompute all costs");
    expect(html).not.toContain("Capture home position");
  });
});
