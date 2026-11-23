import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
export const types = ['stampPressed', 'stampRetracted', 'placeAdded', 'placeUpdated', 'placeRemoved', 'appVersionChanged'] as const;
type ChangeType = typeof types[number];
type Change = { id: number; type: ChangeType; payload: unknown };
type Row = { id: number; type: ChangeType; payload: string };
type Client = { controller: ReadableStreamDefaultController<Uint8Array>; pending: Change[] | null; last: number; replayedThrough: number; timer?: ReturnType<typeof setInterval> };
export const CLIENT_BUFFER_LIMIT_BYTES = 64 * 1024;
const PUBLISH_DELAY_MS = 10;
const PUBLISH_GAP_WAIT_MS = 100;
const encoder = new TextEncoder();
export class Hub extends DurableObject<Env> {
  private clients = new Set<Client>();
  private publishQueue: Change[] = [];
  private publishFlush?: Promise<void>;
  private flushedThrough = 0;
  private queuePublish(change: Change): Promise<void> {
    this.publishQueue.push(change);
    // request.json() can finish out of order. Batch nearby publishes before sending.
    // If ids are not yet contiguous with the last flushed id, wait once longer for the missing ones.
    this.publishFlush ??= new Promise(resolve => {
      const flush = (final: boolean) => {
        const changes = this.publishQueue.sort((a, b) => a.id - b.id);
        const gap = this.flushedThrough > 0 && (changes[0].id > this.flushedThrough + 1 || changes.some((c, i) => i > 0 && c.id > changes[i - 1].id + 1));
        if (gap && !final) { setTimeout(() => flush(true), PUBLISH_GAP_WAIT_MS); return; }
        this.publishQueue = [];
        this.publishFlush = undefined;
        this.flushedThrough = Math.max(this.flushedThrough, changes[changes.length - 1].id);
        for (const client of this.clients) {
          if (client.pending) client.pending.push(...changes);
          else for (const queued of changes) this.deliver(client, queued);
        }
        resolve();
      };
      setTimeout(() => flush(false), PUBLISH_DELAY_MS);
    });
    return this.publishFlush;
  }
  private send(client: Client, text: string) {
    if (!this.clients.has(client)) return;
    try {
      client.controller.enqueue(encoder.encode(text));
      // Keep every queued frame, but stop adding data to a slow connection.
      if ((client.controller.desiredSize ?? 0) <= 0) this.remove(client);
    }
    catch { this.remove(client); }
  }
  private remove(client: Client) {
    this.clients.delete(client);
    if (client.timer !== undefined) clearInterval(client.timer);
    try { client.controller.close(); } catch { /* already closed */ }
  }
  private deliver(client: Client, change: Change) {
    if (!this.clients.has(client) || change.id <= client.replayedThrough) return;
    // A publish already covered by the D1 snapshot is harmless. A late live
    // event would reverse the stream, so reconnect and let D1 replay instead.
    if (change.id < client.last) { this.remove(client); return; }
    if (change.id === client.last) return;
    this.send(client, `id: ${change.id}\nevent: ${change.type}\ndata: ${JSON.stringify(change.payload)}\n\n`);
    client.last = change.id;
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/publish') {
      const change = await request.json<Change>();
      if (!Number.isSafeInteger(change.id) || change.id <= 0 || !types.includes(change.type) || change.payload === undefined) return new Response('Invalid change', { status: 400 });
      await this.queuePublish(change);
      return new Response(null, { status: 204 });
    }
    if (request.method !== 'GET' || url.pathname !== '/changes') return new Response(null, { status: 404 });
    const raw = request.headers.get('Last-Event-ID') ?? url.searchParams.get('since');
    let client!: Client;
    const stream = new ReadableStream<Uint8Array>({
      start: controller => { client = { controller, pending: [], last: -1, replayedThrough: -1 }; this.clients.add(client); },
      cancel: () => this.remove(client),
    }, new ByteLengthQueuingStrategy({ highWaterMark: CLIENT_BUFFER_LIMIT_BYTES }));
    try {
      // One snapshot query includes bounds and all replay rows; no polling.
      const since = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (raw !== null) {
        const { results } = await this.env.DB.prepare(`
          SELECT c.id, c.type, c.payload, b.lo, b.hi FROM
          (SELECT MIN(id) lo, MAX(id) hi FROM changes) b
          LEFT JOIN changes c ON c.id > ? ORDER BY c.id
        `).bind(Number.isSafeInteger(since) ? since : -1).all<Row & { lo: number | null; hi: number | null }>();
        const { lo, hi } = results[0];
        const rows = results.filter(row => row.id !== null);
        const max = hi ?? 0;
        const missing = rows.some((row, i) => row.id !== since + i + 1);
        if (!Number.isSafeInteger(since) || since < 0 || since > max || (lo !== null && since < lo - 1) || missing) {
          this.send(client, 'event: resync\ndata: {}\n\n');
          this.remove(client);
          return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
        }
        client.last = since;
        client.replayedThrough = since;
        for (const row of rows) this.deliver(client, { ...row, payload: JSON.parse(row.payload) });
        client.replayedThrough = client.last;
      }
      for (const change of client.pending!.sort((a, b) => a.id - b.id)) this.deliver(client, change);
      client.pending = null;
      this.send(client, ': connected\n\n');
      if (this.clients.has(client)) client.timer = setInterval(() => this.send(client, ': ping\n\n'), 25_000);
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    } catch (error) { this.remove(client); throw error; }
  }
}
