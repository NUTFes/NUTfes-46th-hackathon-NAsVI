import { expect, it } from 'vitest';
import { listOperations, object } from '../../../tools/contract/openapi';
import { parseYaml } from '../../../tools/contract/yaml';
import { spec } from './spec';

it('実際の OpenAPI の操作・フロー形式・リスト内マップ・ブロックスカラを読み込む', () => {
  expect(spec.openapi).toBe('3.1.0');
  expect(listOperations(spec)).toHaveLength(22);
  expect(listOperations(spec).map(item => item.operationId)).toContain('showBuildingEvents');
  const info = object(spec.info, 'info');
  expect(info.description).toContain('互換性(API-20)');
  expect(String(info.description)).not.toContain('\n');
  const paths = object(spec.paths, 'paths');
  const changes = object(object(paths['/changes'], 'changes').get, 'get');
  const ok = object(object(changes.responses, 'responses')['200'], '200');
  const stream = object(object(ok.content, 'content')['text/event-stream'], 'media');
  expect(stream.example).toContain('id: 121\nevent: stampPressed\ndata: {');
  expect(String(stream.example).endsWith('\n')).toBe(true);
});

it('スカラ・コメント・クォート・ネストしたフロー形式を扱う', () => {
  expect(parseYaml(`
# コメント
name: 'it''s # quoted'
url: https://example.invalid/test#fragment # コメント
double: "a: b # c"
escaped: "a\\n\\\"b"
values: [true, false, null, "null", -1, 1.5, 1e2, {a: [x, y], b: "x,y:z"}]
items:
  - id: first
    nested:
      flags: [a, b]
  - {id: second}
`)).toEqual({
    name: "it's # quoted", url: 'https://example.invalid/test#fragment', double: 'a: b # c', escaped: 'a\n"b',
    values: [true, false, null, 'null', -1, 1.5, 100, { a: ['x', 'y'], b: 'x,y:z' }],
    items: [{ id: 'first', nested: { flags: ['a', 'b'] } }, { id: 'second' }],
  });
});

it('ブロックスカラ内の # と空行を保存し、折り畳みと末尾改行を扱う', () => {
  expect(parseYaml('folded: >-\n  first\n  second\nliteral: |\n  # data\n\n  last\nnext: ok\n')).toEqual({
    folded: 'first second', literal: '# data\n\nlast\n', next: 'ok',
  });
});

it.each([
  'a: 1\na: 2', 'a: &anchor value', 'a: [unclosed', 'a: "unclosed', 'a:\n\tb: 1',
])('未対応・不正な YAML を黙って読み飛ばさない: %s', source => {
  expect(() => parseYaml(source)).toThrow();
});
