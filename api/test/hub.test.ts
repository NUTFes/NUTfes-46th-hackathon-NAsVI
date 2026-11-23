import { env, SELF, applyD1Migrations } from 'cloudflare:test';
import type { Env } from '../src/index';
import { beforeAll, beforeEach, expect, it } from 'vitest';
declare module 'cloudflare:test' { interface ProvidedEnv extends Env { TEST_MIGRATIONS: D1Migration[] } }
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await env.DB.exec('DELETE FROM changes; DELETE FROM sqlite_sequence WHERE name = \'changes\''); });
async function emit() {
  const response = await SELF.fetch('http://local/dev/emit', { method: 'POST', body: '{}' });
  expect(response.status).toBe(201);
  return await response.json() as { id: number };
}
async function connect(suffix = '', headers = {}) {
  const response = await SELF.fetch(`http://local/changes${suffix}`, { headers });
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return { close: () => reader.cancel(), next: async () => {
    while (true) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (frame.startsWith(':')) continue;
        return frame;
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error('stream ended');
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  } };
}
it('since の続きだけを順に返し Last-Event-ID を優先する', async () => {
  await emit(); const second = await emit();
  const client = await connect('?since=0', { 'Last-Event-ID': '1' });
  try { expect(await client.next()).toContain(`id: ${second.id}\nevent: stampPressed`); } finally { await client.close(); }
});
it('publish が接続中の全員に届く', async () => {
  const clients = await Promise.all([connect(), connect(), connect()]);
  try {
    const change = await emit();
    for (const client of clients) expect(await client.next()).toContain(`id: ${change.id}\nevent: stampPressed`);
  } finally { await Promise.all(clients.map(c => c.close())); }
});
it.each(['999', 'bad'])('範囲外 %s で id のない resync', async since => {
  const client = await connect(`?since=${since}`);
  try { expect(await client.next()).toBe('event: resync\ndata: {}'); } finally { await client.close(); }
});
it('保持範囲より古い番号と途中の欠落を resync にする', async () => {
  await emit(); await emit(); await emit();
  await env.DB.exec('DELETE FROM changes WHERE id = 2');
  const client = await connect('?since=1');
  try { expect(await client.next()).toBe('event: resync\ndata: {}'); } finally { await client.close(); }
});
