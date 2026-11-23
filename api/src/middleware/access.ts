import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv } from '../env';
import { problem } from '../lib/errors';

// Keep jose's expiring JWKS caches within this isolate, separated by team domain.
const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Reset isolate-local JWKS state between tests. */
export function resetAccessJwksCache(): void {
  jwksByDomain.clear();
}

export const requireOperator = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.ACCESS_BYPASS === 'true') {
    c.set('actor', { email: 'operator@example.com' });
    await next();
    return;
  }

  const token = c.req.header('Cf-Access-Jwt-Assertion');
  const { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: audience } = c.env;
  if (!token || !domain || !audience) {
    return problem(c, 401, 'unauthorized', '運営としてログインしてください');
  }

  try {
    let jwks = jwksByDomain.get(domain);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
      jwksByDomain.set(domain, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://${domain}`,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'email'],
    });
    if (typeof payload.email !== 'string' || payload.email.trim().length === 0) {
      return problem(c, 401, 'unauthorized', '運営としてログインしてください');
    }
    c.set('actor', { email: payload.email });
  } catch {
    return problem(c, 401, 'unauthorized', '運営としてログインしてください');
  }

  await next();
});
