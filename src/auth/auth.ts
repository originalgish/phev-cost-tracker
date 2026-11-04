import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FORM_TYPE = /^\s*(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)\b/i;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksFor: string | null = null;

// hono/csrf is not enough here: it lets JSON from other origins and same-origin forms through.
export const rejectCrossSite: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const type = c.req.header("Content-Type") ?? "";
  const origin = c.req.header("Origin");
  const otherOrigin = origin !== undefined && origin !== new URL(c.req.url).origin;
  if (type === "" || FORM_TYPE.test(type) || otherOrigin) return c.json({ error: "forbidden" }, 403);
  await next();
};

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
