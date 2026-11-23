import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet, type JWTPayload } from 'jose';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { AppEnv, Env } from '../src/env';
import { requireOperator, resetAccessJwksCache } from '../src/middleware/access';
import { requestWithEnv } from './helpers';

const domain = 'example.cloudflareaccess.test';
const issuer = `https://${domain}`;
const certsUrl = `${issuer}/cdn-cgi/access/certs`;
const audience = 'example-access-audience';
const email = 'operator@example.test';
const kid = 'example-key';
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let otherKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: JSONWebKeySet;

// Expose actor only on a local test app; real routes are exercised through helpers too.
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

it('実際の運営 API は正しい JWT で認証を通過し、無い場合は 401 を返す', async () => {
  const response = await requestWithEnv('/api/labels', {
    method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await sign() },
  }, bindings());
  expect(response.status).toBe(501);
  expect(await response.json()).toEqual({ code: 'internal_error', message: 'POST /labels は未実装です' });
  await expectUnauthorized(await requestWithEnv('/api/labels', { method: 'POST' }, bindings()));
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
  const response = await requestWithEnv('/api/labels', { method: 'POST' }, bindings({ ACCESS_BYPASS: 'true' }));
  expect(response.status).toBe(501);
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
