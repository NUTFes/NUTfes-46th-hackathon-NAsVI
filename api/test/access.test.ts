import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { base64url, exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet, type JWTPayload } from 'jose';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { AppEnv, Env } from '../src/env';
import { requireOperator, resetAccessJwksCache } from '../src/middleware/access';

const domain = 'example.cloudflareaccess.test';
const issuer = `https://${domain}`;
const certsUrl = `${issuer}/cdn-cgi/access/certs`;
const audience = 'example-access-audience';
const email = 'operator@example.test';
const kid = 'example-key';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: JSONWebKeySet;

// Verify against a minimal local app so tests do not depend on real route implementations.
const actorApp = new Hono<AppEnv>();
actorApp.get('/', requireOperator, c => c.json(c.get('actor')));

function bindings(overrides: Partial<Env> = {}): Env {
  return { ...env, ACCESS_BYPASS: undefined, ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: audience, ...overrides };
}

function sign(claims: JWTPayload = {}, privateKey = keys.privateKey, keyId = kid): Promise<string> {
  return new SignJWT({ email, iss: issuer, aud: [audience], exp: Math.floor(Date.now() / 1000) + 3600, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: keyId })
    .sign(privateKey);
}

function actorRequest(token?: string, overrides: Partial<Env> = {}): Promise<Response> {
  return Promise.resolve(actorApp.fetch(new Request('http://local/', {
    headers: token === undefined ? {} : { 'Cf-Access-Jwt-Assertion': token },
  }), bindings(overrides)));
}

async function expectUnauthorized(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({ code: 'unauthorized', message: '運営としてログインしてください' });
}

beforeAll(async () => {
  [keys, otherKeys] = await Promise.all([generateKeyPair('RS256'), generateKeyPair('RS256')]);
  jwks = { keys: [{ ...await exportJWK(keys.publicKey), alg: 'RS256', use: 'sig', kid }] };
});

beforeEach(() => {
  resetAccessJwksCache();
  // Every test intercepts global fetch; even unexpected URLs never reach the network.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    expect(String(input)).toBe(certsUrl);
    return Response.json(jwks);
  });
});

afterEach(() => {
  resetAccessJwksCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('正しい JWT を検証して payload.email を actor に設定する', async () => {
  const response = await actorRequest(await sign({ email: 'another@example.test' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ email: 'another@example.test' });
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect(globalThis.fetch).toHaveBeenCalledWith(certsUrl, expect.objectContaining({ method: 'GET', redirect: 'manual' }));
});

it.each([
  ['期限切れ', () => ({ exp: Math.floor(Date.now() / 1000) - 60 })],
  ['期限が現在時刻', () => ({ exp: Math.floor(Date.now() / 1000) })],
  ['aud 不一致', () => ({ aud: ['other-audience'] })],
  ['issuer 不一致', () => ({ iss: 'https://other.cloudflareaccess.test' })],
  ['まだ有効でない', () => ({ nbf: Math.floor(Date.now() / 1000) + 60 })],
  ['exp 欠落', () => ({ exp: undefined })],
  ['aud 欠落', () => ({ aud: undefined })],
  ['issuer 欠落', () => ({ iss: undefined })],
  ['email 欠落', () => ({ email: undefined })],
  ['email が文字列でない', () => ({ email: 123 })],
  ['email が空', () => ({ email: '' })],
  ['email が空白のみ', () => ({ email: '   ' })],
] satisfies [string, () => JWTPayload][])('%s の JWT は 401', async (_label, claims) => {
  await expectUnauthorized(await actorRequest(await sign(claims())));
});

it('同じ kid でも別の秘密鍵で署名した JWT は 401', async () => {
  await expectUnauthorized(await actorRequest(await sign({}, otherKeys.privateKey)));
});

it('JWKS に無い kid は 401', async () => {
  await expectUnauthorized(await actorRequest(await sign({}, keys.privateKey, 'unknown-key')));
});

it('alg=none の偽装 JWT は 401', async () => {
  const enc = (v: object) => base64url.encode(JSON.stringify(v));
  const token = `${enc({ alg: 'none', kid })}.${enc({ email, iss: issuer, aud: [audience], exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
  await expectUnauthorized(await actorRequest(token));
});

it('公開鍵を HMAC 鍵に見立てた HS256 の JWT は 401', async () => {
  const secret = new TextEncoder().encode(JSON.stringify(jwks.keys[0]));
  const token = await new SignJWT({ email, iss: issuer, aud: [audience], exp: Math.floor(Date.now() / 1000) + 3600 })
    .setProtectedHeader({ alg: 'HS256', kid }).sign(secret);
  await expectUnauthorized(await actorRequest(token));
});

it('RS256 以外(RS384)で署名した JWT は 401', async () => {
  const rs384 = await generateKeyPair('RS384');
  const rsJwks = { keys: [{ ...await exportJWK(rs384.publicKey), alg: 'RS384', use: 'sig', kid }] };
  vi.mocked(globalThis.fetch).mockImplementation(async () => Response.json(rsJwks));
  const token = await new SignJWT({ email, iss: issuer, aud: [audience], exp: Math.floor(Date.now() / 1000) + 3600 })
    .setProtectedHeader({ alg: 'RS384', kid }).sign(rs384.privateKey);
  await expectUnauthorized(await actorRequest(token));
});

it.each([undefined, '', 'not-a-jwt', 'a.b.c'])('ヘッダー %s は 401', async token => {
  await expectUnauthorized(await actorRequest(token));
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each([
  { ACCESS_TEAM_DOMAIN: undefined }, { ACCESS_TEAM_DOMAIN: '' },
  { ACCESS_AUD: undefined }, { ACCESS_AUD: '' },
])('設定 %j が欠けると、正しい JWT でも 401', async overrides => {
  await expectUnauthorized(await actorRequest(await sign(), overrides));
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('ACCESS_BYPASS=true だけが設定・JWT の検証を迂回する', async () => {
  for (const token of [undefined, 'invalid-jwt']) {
    const response = await actorRequest(token, { ACCESS_BYPASS: 'true', ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: 'operator@example.com' });
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it.each([undefined, 'false', 'TRUE', '1', 'true '])('ACCESS_BYPASS=%s では検証を迂回しない', async bypass => {
  await expectUnauthorized(await actorRequest(undefined, { ACCESS_BYPASS: bypass }));
});

it.each(['通信失敗', 'HTTP エラー', '不正な JSON', '不正な JWKS'] as const)('JWKS の%sは 401', async failure => {
  vi.mocked(globalThis.fetch).mockImplementation(async () => {
    if (failure === '通信失敗') throw new Error('example fetch failure');
    if (failure === 'HTTP エラー') return new Response(null, { status: 503 });
    if (failure === '不正な JSON') return new Response('not-json');
    return Response.json({ keys: 'invalid' });
  });
  await expectUnauthorized(await actorRequest(await sign()));
});

it('同じチームの JWKS をリクエスト間でキャッシュするが、aud は毎回検証する', async () => {
  const token = await sign();
  expect((await actorRequest(token)).status).toBe(200);
  expect((await actorRequest(token)).status).toBe(200);
  await expectUnauthorized(await actorRequest(token, { ACCESS_AUD: 'other-audience' }));
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

it('異なるチームの JWKS は共有しない', async () => {
  expect((await actorRequest(await sign())).status).toBe(200);
  const otherDomain = 'other.cloudflareaccess.test';
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(Response.json({ keys: [{
    ...await exportJWK(otherKeys.publicKey), alg: 'RS256', use: 'sig', kid,
  }] }));
  const token = await sign({ iss: `https://${otherDomain}` });
  await expectUnauthorized(await actorRequest(token, { ACCESS_TEAM_DOMAIN: otherDomain }));
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  expect(globalThis.fetch).toHaveBeenLastCalledWith(`https://${otherDomain}/cdn-cgi/access/certs`, expect.any(Object));
});

it('JWKS 取得失敗をキャッシュせず次のリクエストで再取得する', async () => {
  const token = await sign();
  vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('example fetch failure'));
  await expectUnauthorized(await actorRequest(token));
  expect((await actorRequest(token)).status).toBe(200);
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

it('JWKS キャッシュの期限後に再取得し、失敗時は古い鍵で許可しない', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const token = await sign();
  expect((await actorRequest(token)).status).toBe(200);
  vi.setSystemTime(Date.now() + 11 * 60 * 1000);
  vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('example fetch failure'));
  await expectUnauthorized(await actorRequest(token));
  expect((await actorRequest(token)).status).toBe(200);
  expect(globalThis.fetch).toHaveBeenCalledTimes(3);
});

it('クールダウン後に未知の kid を受けたら JWKS を再取得して鍵の変更を扱う', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  expect((await actorRequest(await sign())).status).toBe(200);
  vi.setSystemTime(Date.now() + 31 * 1000);
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(Response.json({ keys: [{
    ...await exportJWK(otherKeys.publicKey), alg: 'RS256', use: 'sig', kid: 'rotated-key',
  }] }));
  expect((await actorRequest(await sign({}, otherKeys.privateKey, 'rotated-key'))).status).toBe(200);
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

function cookieRequest(token: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(actorApp.fetch(new Request('http://local/', {
    headers: { Cookie: `other=1; CF_Authorization=${token}; x=y`, ...headers },
  }), bindings()));
}

it('Cookie の JWT は、同一オリジンのリクエストなら検証して受け入れる', async () => {
  const response = await cookieRequest(await sign({ email: 'cookie@example.test' }), { 'Sec-Fetch-Site': 'same-origin' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ email: 'cookie@example.test' });
});

it.each([undefined, 'cross-site', 'same-site', 'none'])('Cookie の JWT は Sec-Fetch-Site=%s では 401', async site => {
  const headers: Record<string, string> = site === undefined ? {} : { 'Sec-Fetch-Site': site };
  await expectUnauthorized(await cookieRequest(await sign(), headers));
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('Cookie の JWT も、署名・aud・期限は同じように検証する', async () => {
  const same = { 'Sec-Fetch-Site': 'same-origin' };
  await expectUnauthorized(await cookieRequest(await sign({ aud: ['other-audience'] }), same));
  await expectUnauthorized(await cookieRequest(await sign({}, otherKeys.privateKey), same));
  await expectUnauthorized(await cookieRequest(await sign({ exp: Math.floor(Date.now() / 1000) - 60 }), same));
  await expectUnauthorized(await cookieRequest('', same));
});

it('ヘッダーと Cookie の両方があるときは、ヘッダーを使う', async () => {
  const response = await actorApp.fetch(new Request('http://local/', {
    headers: {
      'Cf-Access-Jwt-Assertion': await sign({ email: 'header@example.test' }),
      Cookie: `CF_Authorization=${await sign({ email: 'cookie@example.test' })}`,
      'Sec-Fetch-Site': 'same-origin',
    },
  }), bindings());
  expect(await response.json()).toEqual({ email: 'header@example.test' });
});
