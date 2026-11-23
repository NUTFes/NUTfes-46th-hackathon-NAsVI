import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
export const types = ['stampPressed', 'stampRetracted', 'placeAdded', 'placeUpdated', 'placeRemoved', 'appVersionChanged'] as const;
type ChangeType = typeof types[number];
type Change = { id: number; type: ChangeType; payload: unknown };
type Row = { id: number; type: ChangeType; payload: string };
type Client = { controller: ReadableStreamDefaultController<Uint8Array>; pending: Change[] | null; last: number; timer?: ReturnType<typeof setInterval> };
const encoder = new TextEncoder();
export class Hub extends DurableObject<Env> {
  private clients = new Set<Client>();
  private send(client: Client, text: string) {
    try { client.controller.enqueue(encoder.encode(text)); }
    catch { this.remove(client); }
  }
  private remove(client: Client) {
    this.clients.delete(client);
    if (client.timer !== undefined) clearInterval(client.timer);
    try { client.controller.close(); } catch { /* already closed */ }
  }
  private deliver(client: Client, change: Change, deduplicate = false) {
    if (deduplicate && change.id <= client.last) return;
    this.send(client, `id: ${change.id}\nevent: ${change.type}\ndata: ${JSON.stringify(change.payload)}\n\n`);
    client.last = Math.max(client.last, change.id);
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/publish') {
      const change = await request.json<Change>();
      if (!Number.isSafeInteger(change.id) || change.id <= 0 || !types.includes(change.type) || change.payload === undefined) return new Response('Invalid change', { status: 400 });
      for (const client of this.clients) {
        if (client.pending) client.pending.push(change);
        else this.deliver(client, change);
      }
      return new Response(null, { status: 204 });
    }
    if (request.method !== 'GET' || url.pathname !== '/changes') return new Response(null, { status: 404 });
    const raw = request.headers.get('Last-Event-ID') ?? url.searchParams.get('since');
    let client!: Client;
    const stream = new ReadableStream<Uint8Array>({
      start: controller => { client = { controller, pending: [], last: -1 }; this.clients.add(client); },
      cancel: () => this.remove(client),
    });
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
        for (const row of rows) this.deliver(client, { ...row, payload: JSON.parse(row.payload) }, true);
      }
      for (const change of client.pending!.sort((a, b) => a.id - b.id)) this.deliver(client, change, true);
      client.pending = null;
      this.send(client, ': connected\n\n');
      if (this.clients.has(client)) client.timer = setInterval(() => this.send(client, ': ping\n\n'), 25_000);
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    } catch (error) { this.remove(client); throw error; }
  }
}
