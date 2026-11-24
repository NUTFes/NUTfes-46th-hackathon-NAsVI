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

const ACCESS_COOKIE = 'CF_Authorization';

/**
 * Access の JWT を取り出す。ヘッダー(Access が守るパスに付く)を優先する。
 * 運営の書き込みは来場者と同じパス(POST /places など)で、Access の保護の外にあるため
 * ヘッダーが付かない。そこでログイン Cookie の JWT も読む。署名・iss・aud・exp の検証は同じ。
 * Cookie は他サイトからのリクエストにも付き得るので(CSRF)、Cookie 経由は
 * Sec-Fetch-Site が same-origin のときだけ受け入れる(欠けていれば受け入れない)。
 */
function accessToken(headers: Headers): string | undefined {
  const header = headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  if (headers.get('Sec-Fetch-Site') !== 'same-origin') return undefined;
  for (const part of (headers.get('Cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === ACCESS_COOKIE) return part.slice(eq + 1).trim() || undefined;
  }
  return undefined;
}

export const requireOperator =createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.ACCESS_BYPASS === 'true') {
    c.set('actor', { email: 'operator@example.com' });
    await next();
    return;
  }

  const token = accessToken(c.req.raw.headers);
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
