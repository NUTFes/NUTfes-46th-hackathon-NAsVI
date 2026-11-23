const changeTypes = [
  'stampPressed', 'stampRetracted', 'placeAdded', 'placeUpdated', 'placeRemoved',
  'appVersionChanged',
] as const;

export type ChangeType = typeof changeTypes[number];

export interface ChangeEvent {
  id: number;
  type: ChangeType;
  payload: unknown;
}

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: any) => void): void;
  close(): void;
}

export interface ConnectChangesOptions {
  since: string | number;
  onEvent(event: ChangeEvent): void;
  onResync(): void;
  EventSource?: new (url: string) => EventSourceLike;
  fetch?: typeof globalThis.fetch;
  random?: () => number;
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

// 基数・上限の数値は暫定。揺らぎは上限を適用した後に足す。
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const JITTER_MS = 10_000;
const STABLE_CONNECTION_MS = 30_000;

/** resync 後は一覧を取り直し、新しい cursor で呼び直す。 */
export function connectChanges({
  since, onEvent, onResync,
  EventSource: EventSourceCtor = globalThis.EventSource,
  fetch: fetchChanges = globalThis.fetch.bind(globalThis),
  random = Math.random,
  document: visibility = globalThis.document,
}: ConnectChangesOptions): { close(): void } {
  let cursor = String(since);
  let source: EventSourceLike | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let probe: AbortController | undefined;
  let failures = 0;
  let closed = false;

  const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');
  const url = () => `${base}/changes?since=${encodeURIComponent(cursor)}`;
  const isHidden = () => visibility.visibilityState === 'hidden';

  function resetFailures() {
    failures = 0;
    clearTimeout(stableTimer);
    stableTimer = undefined;
  }

  function closeSource() {
    clearTimeout(stableTimer);
    stableTimer = undefined;
    const previous = source;
    source = undefined;
    previous?.close();
  }

  function suspend() {
    closeSource();
    clearTimeout(timer);
    timer = undefined;
    const previous = probe;
    probe = undefined;
    previous?.abort();
  }

  function close() {
    if (closed) return;
    closed = true;
    visibility.removeEventListener('visibilitychange', onVisibilityChange);
    suspend();
  }

  async function scheduleReconnect() {
    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** failures);
    failures += 1;
    const controller = new AbortController();
    probe = controller;
    let retryAfterMs = 0;
    try {
      // EventSource からは HTTP ステータスを読めないため、同じ URL を一度だけ調べる。
      const response = await fetchChanges(url(), {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (response.status === 429) {
        const seconds = response.headers.get('Retry-After')?.trim();
        if (seconds && /^\d+$/.test(seconds)) {
          const milliseconds = Number(seconds) * 1_000;
          if (Number.isFinite(milliseconds)) retryAfterMs = milliseconds;
        }
      }
    } catch {
      // プローブが失敗しても、通常の待ち時間で再接続する。
    } finally {
      // 200 の場合は SSE が続くので、本文を読まずヘッダーを得た時点で中断する。
      controller.abort();
    }
    // 非表示・close 後や、古いプローブの完了からは再接続しない。
    if (probe !== controller) return;
    probe = undefined;
    if (closed || isHidden()) return;
    timer = setTimeout(() => {
      timer = undefined;
      connect();
    }, Math.max(delay, retryAfterMs) + random() * JITTER_MS);
  }

  function connect() {
    if (closed || isHidden() || source || timer !== undefined || probe) return;
    const current = new EventSourceCtor(url());
    source = current;
    current.addEventListener('open', () => {
      if (source !== current || closed || stableTimer !== undefined) return;
      // 接続直後の切断が続く間は、指数的な待ちを維持する。
      stableTimer = setTimeout(() => {
        if (source === current && !closed) resetFailures();
      }, STABLE_CONNECTION_MS);
    });
    current.addEventListener('error', () => {
      if (source !== current || closed) return;
      // ブラウザの自動再接続を止め、since を付けて自分で接続し直す。
      closeSource();
      void scheduleReconnect();
    });
    for (const type of changeTypes) {
      current.addEventListener(type, (event) => {
        if (source !== current || closed) return;
        const message = event as MessageEvent<string>;
        const id = Number(message.lastEventId);
        if (!/^\d+$/.test(message.lastEventId) || !Number.isSafeInteger(id)) return;
        let payload: unknown;
        try {
          payload = JSON.parse(message.data);
        } catch {
          return;
        }
        cursor = message.lastEventId;
        resetFailures();
        onEvent({ id, type, payload });
      });
    }
    current.addEventListener('resync', () => {
      if (source !== current || closed) return;
      close();
      onResync();
    });
  }

  function onVisibilityChange() {
    if (closed) return;
    if (isHidden()) suspend();
    else connect();
  }

  visibility.addEventListener('visibilitychange', onVisibilityChange);
  connect();
  return { close };
}
