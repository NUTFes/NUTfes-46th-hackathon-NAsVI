import type { components, paths } from './generated/schema';

type Problem = components['schemas']['Error'];
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

type SuccessResponse<Operation> = Operation extends { responses: infer Responses }
  ? {
      [Status in keyof Responses]: Status extends 200 | 201 | 202
        ? Responses[Status] extends { content: { 'application/json': infer Data } }
          ? Data
          : never
        : Status extends 204 ? void : never;
    }[keyof Responses]
  : never;

// SSE (/changes) は JSON クライアントの対象にしない。
type JsonPath<M extends Method> = {
  [P in keyof paths]: [SuccessResponse<paths[P][M]>] extends [never] ? never : P;
}[keyof paths];

type Options<Operation> = Omit<RequestInit, 'method' | 'body'>
  & (Operation extends { parameters: { path: infer Params extends object } }
    ? { params: Params } : { params?: never })
  & (Operation extends { parameters: { query: infer Query extends object } }
    ? { query: Query } : { query?: never })
  & (Operation extends { requestBody: { content: { 'application/json': infer Body } } }
    ? { body: Body } : { body?: never });

type Args<Operation> = {} extends Options<Operation>
  ? [options?: Options<Operation>]
  : [options: Options<Operation>];

export class ApiError extends Error {
  readonly code: Problem['code'];
  readonly field: Problem['field'];
  readonly status: number;

  constructor(problem: Problem, status: number) {
    super(problem.message);
    this.name = 'ApiError';
    this.code = problem.code;
    this.field = problem.field;
    this.status = status;
  }
}

/**
 * 例: apiGet('/places/search', { query: { q: '焼きそば' } })
 * VITE_API_BASE は /api を含む基底 URL。未設定なら同一オリジンの /api。
 */
export function apiGet<P extends JsonPath<'get'>>(
  path: P,
  ...args: Args<paths[NoInfer<P>]['get']>
): Promise<SuccessResponse<paths[P]['get']>> {
  return request('GET', path, args[0]);
}

/**
 * 例: apiSend('POST', '/labels', { body: { title: '飲食' } })
 * パス変数は params、X-Stamp-Proof などは headers に渡す。
 */
export function apiSend<M extends 'POST' | 'PUT' | 'PATCH' | 'DELETE', P extends JsonPath<Lowercase<M>>>(
  method: M,
  path: P,
  ...args: Args<paths[NoInfer<P>][Lowercase<NoInfer<M>>]>
): Promise<SuccessResponse<paths[P][Lowercase<M>]>> {
  return request(method, path, args[0]);
}

type RequestOptions = Omit<RequestInit, 'method' | 'body'> & {
  params?: object;
  query?: object;
  body?: unknown;
};

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { params, query, body, headers: suppliedHeaders, ...init } = options;
  for (const [name, value] of Object.entries(params ?? {})) {
    path = path.replaceAll(`{${name}}`, encodeURIComponent(String(value)));
  }
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) search.set(name, String(value));
  }
  const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');
  const url = `${base}${path}${search.size ? `?${search}` : ''}`;
  const headers = new Headers(suppliedHeaders);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, application/problem+json');
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  // ネットワークエラーや AbortError は、HTTP エラーと区別できるようそのまま伝える。
  const response = await fetch(url, {
    ...init,
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function isProblem(value: unknown): value is Problem {
  return typeof value === 'object' && value !== null
    && 'code' in value && typeof value.code === 'string'
    && 'message' in value && typeof value.message === 'string'
    && (!('field' in value) || typeof value.field === 'string');
}

async function toApiError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (contentType === 'application/problem+json') {
    const problem: unknown = await response.json().catch(() => null);
    if (isProblem(problem)) return new ApiError(problem, response.status);
  }
  // プロキシなどの HTML エラーや壊れた応答でも HTTP ステータスを失わない。
  return new ApiError({
    code: 'internal_error',
    message: '時間をおいて、もう一度試してください',
  }, response.status);
}
