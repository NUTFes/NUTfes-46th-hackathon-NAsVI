import { env, runInDurableObject } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { CLIENT_BUFFER_LIMIT_BYTES } from '../src/hub/Hub';
import { migrateTestDb } from './helpers';

beforeAll(() => migrateTestDb());
beforeEach(async () => {
  await env.DB.exec("DELETE FROM changes; DELETE FROM sqlite_sequence WHERE name = 'changes'");
});

function hub() {
  return env.HUB.get(env.HUB.idFromName(crypto.randomUUID()));
}
type Stub = ReturnType<typeof hub>;

// All requests use the local Durable Object binding, without public fetches.
async function publish(stub: Stub, id: number, payload: unknown = { id: `place-${id}` }) {
  const response = await stub.fetch('http://hub/publish', {
    method: 'POST',
    body: JSON.stringify({ id, type: 'placeRemoved', payload }),
  });
  expect(response.status).toBe(204);
}

async function connect(stub: Stub, suffix = '', headers: Record<string, string> = {}) {
  const response = await stub.fetch(`http://hub/changes${suffix}`, { headers });
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    close: () => reader.cancel(),
    next: async (): Promise<string | null> => {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (frame.startsWith(':')) continue;
          return frame;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const chunk = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Timed out waiting for SSE data or closure')), 1_000);
            }),
          ]);
          if (chunk.done) return null;
          buffer += decoder.decode(chunk.value, { stream: true });
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
    },
  };
}

async function seed(ids: number[]) {
  if (ids.length === 0) return;
  await env.DB.batch(ids.map(id => env.DB.prepare(
    'INSERT INTO changes (id, type, payload, created_at) VALUES (?, ?, ?, ?)',
  ).bind(id, 'placeRemoved', JSON.stringify({ id: `place-${id}` }), '2026-11-24T00:00:00Z')));
}

it('同時 publish を id 昇順で全接続に送る', async () => {
  const stub = hub();
  const clients = await Promise.all([connect(stub), connect(stub)]);
  try {
    await Promise.all([3, 1, 2].map(id => publish(stub, id)));
    for (const client of clients) {
      for (const id of [1, 2, 3]) expect(await client.next()).toContain(`id: ${id}\nevent: placeRemoved`);
    }
  } finally {
    await Promise.all(clients.map(client => client.close()));
  }
});

it('request.json() が逆順に完了しても同時 publish を並べ直す', async () => {
  const stub = hub();
  const client = await connect(stub);
  try {
    await runInDurableObject(stub, async instance => {
      const requests = [1, 2, 3].map(id => {
        let finish!: () => void;
        const body = new Promise(resolve => {
          finish = () => resolve({ id, type: 'placeRemoved', payload: { id: `place-${id}` } });
        });
        const request = new Request('http://hub/publish', { method: 'POST', body: '{}' });
        Object.defineProperty(request, 'json', { value: () => body });
        return { finish, response: instance.fetch(request) };
      });
      for (const index of [2, 1, 0]) requests[index].finish();
      const responses = await Promise.all(requests.map(request => request.response));
      expect(responses.map(response => response.status)).toEqual([204, 204, 204]);
    });
    for (const id of [1, 2, 3]) expect(await client.next()).toContain(`id: ${id}\nevent: placeRemoved`);
  } finally {
    await client.close();
  }
});

it('flush 済みの id より小さい publish は逆順に流さず接続を閉じる', async () => {
  const stub = hub();
  const client = await connect(stub);
  try {
    await publish(stub, 2);
    expect(await client.next()).toContain('id: 2\nevent: placeRemoved');
    await publish(stub, 1);
    expect(await client.next()).toBeNull();
  } finally {
    await client.close();
  }
});

it('D1 再送と重なる publish で切断せず、その後のライブ配信を続ける', async () => {
  await seed([1, 2]);
  const stub = hub();
  const client = await connect(stub, '?since=0');
  try {
    for (const id of [1, 2]) expect(await client.next()).toContain(`id: ${id}\nevent: placeRemoved`);
    await Promise.all([publish(stub, 1), publish(stub, 3)]);
    expect(await client.next()).toContain('id: 3\nevent: placeRemoved');
  } finally {
    await client.close();
  }
});

it('読まない接続がバイト上限に達したら間引かず閉じ、ほかの接続を配信し続ける', async () => {
  const stub = hub();
  const slow = await connect(stub);
  try {
    // POST directly to the DO: the public API's input limit is unrelated here.
    // Multiple large frames also fill any buffering in the service binding.
    const payload = { text: 'あ'.repeat(CLIENT_BUFFER_LIMIT_BYTES) };
    for (let id = 1; id <= 8; id++) await publish(stub, id, payload);
    const healthy = await connect(stub);
    try {
      await publish(stub, 9);
      expect(await healthy.next()).toContain('id: 9\nevent: placeRemoved');
      const received: number[] = [];
      for (let frame = await slow.next(); frame !== null; frame = await slow.next()) {
        received.push(Number(/^id: (\d+)/.exec(frame)![1]));
        expect(JSON.parse(frame.split('\ndata: ')[1])).toEqual(payload);
      }
      expect(received.length).toBeGreaterThan(0);
      expect(received.length).toBeLessThan(8);
      expect(received).toEqual(Array.from({ length: received.length }, (_, i) => i + 1));
    } finally {
      await healthy.close();
    }
  } finally {
    await slow.close();
  }
});

it.each(['', 'bad', '-1', '1.5', '9007199254740992', '0', '1', '6'])(
  '不正または保持範囲外の since=%s は id なしの resync だけを送って閉じる', async since => {
    await seed([3, 4, 5]);
    const client = await connect(hub(), `?since=${since}`);
    try {
      expect(await client.next()).toBe('event: resync\ndata: {}');
      expect(await client.next()).toBeNull();
    } finally {
      await client.close();
    }
  },
);

it('since より後の履歴に欠落があれば部分再送せず resync で閉じる', async () => {
  await seed([1, 3, 4]);
  const client = await connect(hub(), '?since=1');
  try {
    expect(await client.next()).toBe('event: resync\ndata: {}');
    expect(await client.next()).toBeNull();
  } finally {
    await client.close();
  }
});

it.each([
  { ids: [3, 4, 5], since: 2, replay: [3, 4, 5] },
  { ids: [3, 4, 5], since: 5, replay: [] },
  { ids: [1, 3, 4], since: 3, replay: [4] },
  { ids: [], since: 0, replay: [] },
])('続きが保持されていれば since=$since を受け入れる ($ids)', async ({ ids, since, replay }) => {
  await seed(ids);
  const stub = hub();
  const client = await connect(stub, `?since=${since}`);
  try {
    for (const id of replay) expect(await client.next()).toContain(`id: ${id}\nevent: placeRemoved`);
    const next = Math.max(0, ...ids) + 1;
    await publish(stub, next);
    expect(await client.next()).toContain(`id: ${next}\nevent: placeRemoved`);
  } finally {
    await client.close();
  }
});

it('空の履歴で 0 より大きい since は resync で閉じる', async () => {
  const client = await connect(hub(), '?since=1');
  try {
    expect(await client.next()).toBe('event: resync\ndata: {}');
    expect(await client.next()).toBeNull();
  } finally {
    await client.close();
  }
});

it('不正な Last-Event-ID も有効な since より優先して resync で閉じる', async () => {
  await seed([1]);
  const client = await connect(hub(), '?since=0', { 'Last-Event-ID': 'bad' });
  try {
    expect(await client.next()).toBe('event: resync\ndata: {}');
    expect(await client.next()).toBeNull();
  } finally {
    await client.close();
  }
});
