import { describe, expect, it, vi } from 'vitest';
import { listOperations, object, resolveRef } from '../../../tools/contract/openapi';
import { reportCoverage } from '../../../tools/contract/report';
import { validateSchema } from '../../../tools/contract/schema';
import { validateResponse, type ResponseInput } from '../../../tools/contract/validate';
import { spec } from './spec';

const place = {
  id: 'pl_01', name: '屋台', kind: 'event', location: { lat: 37.425, lng: 138.778 },
  description: '', landmarkId: null, floor: null, labelIds: [],
  hours: [{ start: '2026-11-28T02:00:00.000Z', end: '2026-11-28T06:00:00.000Z' }],
};
const response: ResponseInput = {
  method: 'GET', path: '/api/places', status: 200, contentType: 'application/json; charset=UTF-8',
  body: { items: [place], cursor: '0' },
};

describe('validateResponse', () => {
  it('一致する一覧・nullable・ネストした参照・UTC の hours を通す', () => {
    expect(validateResponse(spec, response)).toEqual([]);
  });

  it('OpenAPI 内の全レスポンス例を読み込んで検証する (SSE は除く)', () => {
    let checked = 0;
    for (const operation of listOperations(spec)) {
      if (operation.path === '/changes') continue;
      for (const [status, value] of Object.entries(object(operation.definition.responses, 'responses'))) {
        const definition = object(resolveRef(spec, value), 'response');
        if (!definition.content) continue;
        for (const [contentType, mediaValue] of Object.entries(object(definition.content, 'content'))) {
          const media = object(mediaValue, 'media');
          if (!Object.hasOwn(media, 'example')) continue;
          expect(validateResponse(spec, {
            ...operation, status: Number(status), contentType, body: media.example,
          }), `${operation.operationId} ${status}`).toEqual([]);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('OpenAPI 内の examples (複数形) もスキーマに合うか検証する', () => {
    let checked = 0;
    for (const operation of listOperations(spec)) {
      if (operation.path === '/changes') continue;
      for (const [status, value] of Object.entries(object(operation.definition.responses, 'responses'))) {
        const definition = object(resolveRef(spec, value), 'response');
        if (!definition.content) continue;
        for (const [contentType, mediaValue] of Object.entries(object(definition.content, 'content'))) {
          const media = object(mediaValue, 'media');
          if (media.examples === undefined) continue;
          for (const [name, example] of Object.entries(object(media.examples, 'examples'))) {
            const body = object(resolveRef(spec, example), 'example').value;
            expect(validateResponse(spec, { ...operation, status: Number(status), contentType, body }), `${operation.operationId} ${status} ${name}`).toEqual([]);
            checked++;
          }
        }
      }
    }
    // 現在の openapi には examples が無い(0 件)。追加されたら自動で検証される。
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it('examples の不一致を検出する', () => {
    const doc = { paths: { '/t': { get: { operationId: 't', responses: { '200': { content: { 'application/json': {
      schema: { type: 'object', required: ['a'] }, examples: { bad: { value: {} } },
    } } } } } } } };
    const media = (doc.paths['/t'].get.responses['200'].content['application/json']);
    expect(validateResponse(doc, { method: 'GET', path: '/t', status: 200, contentType: 'application/json', body: media.examples.bad.value })[0].path).toBe('$.a');
  });

  it.each([
    { body: {}, path: '$.items' },
    { body: { items: [{ ...place, name: 42 }] }, path: '$.items[0].name' },
    { body: { items: [{ ...place, location: { lat: '37', lng: 138 } }] }, path: '$.items[0].location.lat' },
    { body: { items: [{ ...place, floor: 1.5 }] }, path: '$.items[0].floor' },
    { body: { items: [{ ...place, kind: 'unknown' }] }, path: '$.items[0].kind' },
    { body: { items: [{ ...place, location: { lat: 91, lng: 138 } }] }, path: '$.items[0].location.lat' },
    { body: { items: [{ ...place, hours: [{ start: 'yesterday', end: 'tomorrow' }] }] }, path: '$.items[0].hours[0].start' },
  ])('必須項目・型・enum・境界値・date-time の違反を検出する: $path', ({ body, path }) => {
    expect(validateResponse(spec, { ...response, body })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path }),
    ]));
  });

  it.each([
    { status: 202, expected: 'status' },
    { contentType: 'text/plain', expected: 'contentType' },
    { contentType: null, expected: 'contentType' },
    { body: undefined, expected: '$' },
    { method: 'DELETE', path: '/places', expected: 'operation' },
    { path: '/api/unknown', expected: 'operation' },
  ])('未定義ステータス・content-type・操作・本文欠落を検出する: $expected', ({ expected, ...overrides }) => {
    expect(validateResponse(spec, { ...response, ...overrides })).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expected }),
    ]));
  });

  it('共通エラーレスポンスの参照と実パスを解決する', () => {
    const error: ResponseInput = {
      method: 'patch', path: '/api/places/pl_01?test=true', status: 404,
      contentType: 'application/problem+json', body: { code: 'not_found', message: '見つかりません' },
    };
    expect(validateResponse(spec, error)).toEqual([]);
    expect(validateResponse(spec, { ...error, body: { code: 'not_found' } })).toEqual([
      { path: '$.message', message: '必須項目がありません' },
    ]);
    expect(validateResponse(spec, { ...error, contentType: 'application/json' })[0].path).toBe('contentType');
  });

  it('本文のない 204 を通し、余分な本文・content-type を検出する', () => {
    const empty: ResponseInput = { method: 'DELETE', path: '/places/pl_01', status: 204 };
    expect(validateResponse(spec, empty)).toEqual([]);
    expect(validateResponse(spec, { ...empty, body: '' })).toEqual([]);
    expect(validateResponse(spec, { ...empty, body: null })[0].path).toBe('$');
    expect(validateResponse(spec, { ...empty, contentType: 'application/json' })[0].path).toBe('contentType');
  });

  it('allOf の Stamp と proof の両方を検証する', () => {
    const stamp = {
      id: 'st_01', kind: 'food', at: place.location,
      pressedAt: '2026-11-28T11:00:00+09:00', expiresAt: '2026-11-28T07:00:00Z', proof: 'secret',
    };
    const pressed: ResponseInput = { method: 'POST', path: '/stamps', status: 201, contentType: 'application/json', body: stamp };
    expect(validateResponse(spec, pressed)).toEqual([]);
    const { proof: _proof, ...withoutProof } = stamp;
    expect(validateResponse(spec, { ...pressed, body: withoutProof })[0].path).toBe('$.proof');
    expect(validateResponse(spec, { ...pressed, body: { ...stamp, at: {} } })).toHaveLength(2);
  });

  it('minItems を nullable な footprint にだけ適用する', () => {
    const landmark = { id: 'lm_01', name: '棟', location: place.location, footprint: null, floors: [] };
    const listed: ResponseInput = { method: 'GET', path: '/landmarks', status: 200, contentType: 'application/json', body: { items: [landmark] } };
    expect(validateResponse(spec, listed)).toEqual([]);
    expect(validateResponse(spec, { ...listed, body: { items: [{ ...landmark, footprint: [] }] } })[0].message).toContain('minItems');
  });

  it('検索の固定パスをパラメータ付きパスより優先する', () => {
    expect(validateResponse(spec, { ...response, path: '/api/places/search?q=屋台' })).toEqual([]);
  });
});

describe('スキーマの部分集合', () => {
  it('oneOf は一致が 0 件でも複数件でも拒否する', () => {
    const rule = { oneOf: [{ type: 'number' }, { type: 'integer' }] };
    expect(validateSchema(spec, rule, 1.5)).toEqual([]);
    expect(validateSchema(spec, rule, '1')).toHaveLength(1);
    expect(validateSchema(spec, rule, 1)).toHaveLength(1);
  });

  it('nullable と additionalProperties の禁止・値の制約を扱う', () => {
    expect(validateSchema(spec, { type: 'string', nullable: true }, null)).toEqual([]);
    expect(validateSchema(spec, { type: 'string' }, null)).toHaveLength(1);
    expect(validateSchema(spec, { properties: { id: { type: 'string' } }, additionalProperties: false }, { id: 'a', extra: 1 })[0].path).toBe('$.extra');
    expect(validateSchema(spec, { additionalProperties: { type: 'integer' } }, { count: 1 })).toEqual([]);
    expect(validateSchema(spec, { additionalProperties: { type: 'integer' } }, { count: '1' })[0].path).toBe('$.count');
    expect(validateSchema(spec, { type: 'object' }, { extra: true })).toEqual([]);
  });

  it('数値・文字数・要素数・プロパティ数の境界を含めて検証する', () => {
    const rule = { type: 'object', minProperties: 1, properties: {
      title: { type: 'string', minLength: 1, maxLength: 2 },
      count: { type: 'integer', minimum: -5, maximum: 20 },
      items: { type: 'array', minItems: 1, items: { type: 'boolean' } },
    } };
    expect(validateSchema(spec, rule, { title: '🍣あ', count: -5, items: [true] })).toEqual([]);
    expect(validateSchema(spec, rule, { title: 'あい', count: 20 })).toEqual([]);
    expect(validateSchema(spec, rule, {})).toHaveLength(1);
    expect(validateSchema(spec, rule, { title: '', count: -6, items: [] })).toHaveLength(3);
    expect(validateSchema(spec, rule, { title: 'あいう', count: 21, items: ['true'] })).toHaveLength(3);
  });

  it.each(['2026-11-28T02:00:00.000Z', '2026-11-28T11:00:00+09:00', '2024-02-29T00:00:00-05:00'])('date-time を受理する: %s', value => {
    expect(validateSchema(spec, { type: 'string', format: 'date-time' }, value)).toEqual([]);
  });
  it.each(['2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z', '2026-11-28', '2026-11-28T24:00:00Z', '2026-11-28T02:00:00', '2026-11-28T02:00:00+09:60'])('date-time の誤りを検出する: %s', value => {
    expect(validateSchema(spec, { type: 'string', format: 'date-time' }, value)).toHaveLength(1);
  });

  it('解決不能な参照・循環参照・未対応制約は記録して続行する', () => {
    const broken = { paths: { '/test': { get: { operationId: 'test', responses: {
      '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } },
    } } } }, components: { schemas: {} } };
    const input = { method: 'GET', path: '/test', status: 200, contentType: 'application/json', body: {} };
    expect(validateResponse(broken, input)[0].path).toBe('spec');
    expect(() => resolveRef({ components: { schemas: { Loop: { $ref: '#/components/schemas/Loop' } } } }, { $ref: '#/components/schemas/Loop' })).toThrow('循環参照');
    // 未対応の制約は失敗にせず、検証できなかったものとして記録して続行する。
    const unchecked = new Set<string>();
    expect(validateSchema(spec, { type: 'string', pattern: '^a$' }, 'b', '$', 0, unchecked)).toEqual([]);
    expect([...unchecked]).toEqual(['pattern']);
    const viaResponse = new Set<string>();
    const patterned = { paths: { '/t': { get: { operationId: 't', responses: { '200': { content: { 'application/json': { schema: { type: 'string', pattern: '^1$' } } } } } } } } };
    expect(validateResponse(patterned, { method: 'GET', path: '/t', status: 200, contentType: 'application/json', body: 'x', unchecked: viaResponse })).toEqual([]);
    expect([...viaResponse]).toEqual(['pattern']);
  });
});

describe('契約テストの集計', () => {
  it('501 を数えた結果の未実装件数・一覧と skipped を出力する', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(reportCoverage([
        { operationId: 'showPlaces', outcome: 'validated' },
        { operationId: 'showLabels', outcome: 'unimplemented' },
        { operationId: 'defineLabel', outcome: 'unimplemented' },
        { operationId: 'watchChanges', outcome: 'skipped' },
      ], ['pattern'])).toEqual({ validated: 1, unimplemented: ['showLabels', 'defineLabel'], skipped: ['watchChanges'], unchecked: ['pattern'] });
      expect(log).toHaveBeenCalledWith('契約テスト: 未実装 2 件 [showLabels, defineLabel]');
      expect(log).toHaveBeenCalledWith('契約テスト: 検証済み 1 件、skipped 1 件 [watchChanges] (SSE は対象外)');
      expect(log).toHaveBeenCalledWith('契約テスト: 検証できなかった制約 1 件 [pattern] (未対応のため続行)');
      reportCoverage([]);
      expect(log).toHaveBeenCalledWith('契約テスト: 未実装 0 件 []');
    } finally { log.mockRestore(); }
  });
});
