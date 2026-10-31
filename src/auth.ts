import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksFor: string | null = null;

export const requireAccess: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = c.env;
  if (c.env.DEV_AUTH_BYPASS === "1" && new URL(c.req.url).hostname === "localhost") return next();
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!team || !aud || !token) return c.json({ error: "forbidden" }, 403);
  if (jwks === null || jwksFor !== team) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwksFor = team;
  }
  try {
    await jwtVerify(token, jwks, { issuer: team, audience: aud, algorithms: ["RS256"] });
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
};
