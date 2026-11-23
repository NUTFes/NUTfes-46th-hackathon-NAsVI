import { apiGet, apiSend } from '../api/client';

export { ApiError } from '../api/client';

// 呼び出しの型・パス・本文・戻り値は既存クライアントからそのまま引き継ぐ。
// 認可ヘッダーは Cloudflare Access が付ける。画面では認証情報を扱わない。
function withCredentials<T extends (...args: never[]) => unknown>(request: T, optionsIndex: number): T {
  // 引数の位置だけを差し替える境界で、元のジェネリックな呼び出し型を維持する。
  return ((...args: unknown[]) => {
    const options = args[optionsIndex] as RequestInit | undefined;
    args[optionsIndex] = { ...options, credentials: 'include' };
    return Reflect.apply(request, undefined, args);
  }) as unknown as T;
}

export const adminGet = withCredentials(apiGet, 1);
export const adminSend = withCredentials(apiSend, 2);
