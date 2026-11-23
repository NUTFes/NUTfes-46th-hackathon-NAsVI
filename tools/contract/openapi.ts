import { parseYaml } from './yaml';

export type OpenApiSpec = Record<string, unknown>;
export interface Operation {
  method: string;
  path: string;
  operationId: string;
  definition: Record<string, unknown>;
}

export function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context}: オブジェクトではありません`);
  }
  return value as Record<string, unknown>;
}

export function parseOpenApi(source: string): OpenApiSpec {
  const spec = object(parseYaml(source), 'OpenAPI');
  if (typeof spec.openapi !== 'string' || !spec.openapi.startsWith('3.')) throw new Error('OpenAPI 3 が必要です');
  object(spec.paths, 'paths');
  return spec;
}

// 外部参照は使わず、JSON Pointer のエスケープも解決する。
export function resolveRef(spec: OpenApiSpec, value: unknown): unknown {
  const seen = new Set<string>();
  while (value !== null && typeof value === 'object' && !Array.isArray(value) && '$ref' in value) {
    const ref = (value as Record<string, unknown>).$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/components/')) throw new Error(`未対応の参照: ${String(ref)}`);
    if (seen.has(ref)) throw new Error(`循環参照: ${ref}`);
    seen.add(ref);
    let resolved: unknown = spec;
    for (const part of ref.slice(2).split('/')) {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      const parent = object(resolved, ref);
      if (!Object.hasOwn(parent, key)) throw new Error(`参照先がありません: ${ref}`);
      resolved = parent[key];
    }
    // 3.1 の $ref の兄弟にある制約も保持する。
    const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref'));
    value = Object.keys(siblings).length === 0 ? resolved : { allOf: [resolved, siblings] };
  }
  return value;
}

export function listOperations(spec: OpenApiSpec): Operation[] {
  const operations: Operation[] = [];
  const ids = new Set<string>();
  for (const [path, item] of Object.entries(object(spec.paths, 'paths'))) {
    for (const [method, value] of Object.entries(object(resolveRef(spec, item), path))) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(method)) continue;
      const definition = object(value, `${method} ${path}`);
      const operationId = definition.operationId;
      if (typeof operationId !== 'string' || ids.has(operationId)) throw new Error(`operationId が不正か重複しています: ${String(operationId)}`);
      ids.add(operationId);
      operations.push({ method: method.toUpperCase(), path, operationId, definition });
    }
  }
  return operations;
}
