import { listOperations, object, resolveRef, type OpenApiSpec } from './openapi';
import { validateSchema, type Unchecked, type Violation } from './schema';

export interface ResponseInput {
  method: string;
  path: string;
  status: number;
  contentType?: string | null;
  // JSON はデコード済みの値、本文なしは undefined または空文字列で渡す。
  body?: unknown;
  // 渡すと、未対応の制約で検証できなかったものがここに入る(失敗にはしない)。
  unchecked?: Unchecked;
}

function pathCandidates(spec: OpenApiSpec, path: string): string[] {
  const pathname = path.split(/[?#]/, 1)[0];
  const candidates = [pathname];
  if (Array.isArray(spec.servers)) {
    for (const server of spec.servers) {
      const url = object(server, 'server').url;
      if (typeof url === 'string' && url.startsWith('/') && url !== '/') {
        const prefix = url.replace(/\/$/, '');
        if (pathname.startsWith(`${prefix}/`)) candidates.push(pathname.slice(prefix.length));
      }
    }
  }
  return candidates;
}

export function validateResponse(spec: OpenApiSpec, input: ResponseInput): Violation[] {
  const error = (path: string, message: string): Violation[] => [{ path, message }];
  try {
    const candidates = pathCandidates(spec, input.path);
    const operations = listOperations(spec).filter(op => op.method === input.method.toUpperCase());
    const operation = operations.find(op => candidates.includes(op.path)) ?? operations
      .sort((a, b) => (a.path.match(/\{/g)?.length ?? 0) - (b.path.match(/\{/g)?.length ?? 0))
      .find(op => candidates.some(path => {
        const actual = path.split('/');
        const template = op.path.split('/');
        return actual.length === template.length && template.every((part, i) =>
          /^\{[^}]+\}$/.test(part) ? actual[i].length > 0 : part === actual[i]);
      }));
    if (!operation) return error('operation', `未定義の操作: ${input.method} ${input.path}`);
    const responses = object(operation.definition.responses, 'responses');
    const response = responses[String(input.status)] ?? responses[`${Math.floor(input.status / 100)}XX`] ?? responses.default;
    if (response === undefined) return error('status', `未定義のステータス: ${input.status} (${operation.operationId})`);
    const definition = object(resolveRef(spec, response), 'response');
    const content = definition.content === undefined ? {} : object(definition.content, 'content');
    if (Object.keys(content).length === 0) {
      const errors: Violation[] = [];
      if (input.body !== undefined && input.body !== '') errors.push({ path: '$', message: '本文なしの応答に本文があります' });
      if (input.contentType) errors.push({ path: 'contentType', message: '本文なしの応答に content-type があります' });
      return errors;
    }
    const mediaType = input.contentType?.split(';', 1)[0].trim().toLowerCase();
    const entry = Object.entries(content).find(([type]) => type.toLowerCase() === mediaType);
    if (!entry) return error('contentType', `content-type が一致しません (期待: ${Object.keys(content).join(', ')}, 実際: ${input.contentType ?? 'なし'})`);
    const media = object(entry[1], 'media');
    if (input.body === undefined) return error('$', '応答の本文がありません');
    return media.schema === undefined ? [] : validateSchema(spec, media.schema, input.body, '$', 0, input.unchecked);
  } catch (cause) {
    return error('spec', cause instanceof Error ? cause.message : String(cause));
  }
}
