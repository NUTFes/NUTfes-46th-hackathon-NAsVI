import { setTimeout as sleep } from 'node:timers/promises';
const args = process.argv.slice(2);
const options = { url: 'http://127.0.0.1:8787', clients: 50, emits: 20, interval: 100, duration: 5000 };
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]?.slice(2);
  if (!(key in options) || args[i + 1] === undefined) throw new Error('Arguments: --url --clients --emits --interval --duration (milliseconds)');
  options[key] = key === 'url' ? args[i + 1] : Number(args[i + 1]);
}
for (const key of ['clients', 'emits', 'interval', 'duration']) if (!Number.isSafeInteger(options[key]) || options[key] < (key === 'interval' ? 0 : 1)) throw new Error(`Invalid ${key}`);
const controllers = [];
const stats = Array.from({ length: options.clients }, () => ({ received: new Map(), disconnects: 0 }));
let stopping = false;
const emitted = new Set();
async function client(index, onReady) {
  const controller = new AbortController(); controllers.push(controller);
  const timeout = setTimeout(() => controller.abort(), 15000);
  const response = await fetch(new URL('/changes', options.url), { signal: controller.signal });
  clearTimeout(timeout);
  if (!response.ok) throw new Error(`SSE ${response.status}`);
  const reader = response.body.getReader();
  // Read the connected comment before starting emits; all streams are registered.
  const first = await reader.read();
  if (first.done) throw new Error('SSE closed before ready');
  onReady();
  const task = (async () => {
    let buffer = new TextDecoder().decode(first.value);
    const decoder = new TextDecoder();
    try {
      while (true) {
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const id = /^id: (\d+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (id && data) {
            const payload = JSON.parse(data);
            if (typeof payload.sentAt === 'number') stats[index].received.set(Number(id), Date.now() - payload.sentAt);
          }
        }
        const chunk = await reader.read();
        if (chunk.done) { if (!stopping) stats[index].disconnects++; break; }
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    } catch (error) { if (!stopping) { stats[index].disconnects++; console.error(`client ${index}: ${error.message}`); } }
    finally { reader.releaseLock(); }
  })();
  return task;
}
const tasks = [];
try {
  await Promise.all(stats.map((_, i) => new Promise((resolve, reject) => {
    const task = client(i, resolve);
    task.catch(reject);
    tasks.push(task);
  })));
  for (let i = 0; i < options.emits; i++) {
    const response = await fetch(new URL('/dev/emit', options.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sentAt: Date.now() }) });
    if (response.status !== 201) throw new Error(`emit ${response.status}`);
    emitted.add((await response.json()).id);
    await sleep(options.interval);
  }
  // duration is the observation time after the final emit; do not stop early (ping/cleanup).
  await sleep(options.duration);
} finally {
  stopping = true;
  for (const controller of controllers) controller.abort();
  await Promise.allSettled(tasks);
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
  return { median: at(.5), p95: at(.95), max: at(1) };
}
const clients = stats.map((stat, index) => {
  const delays = [...stat.received].filter(([id]) => emitted.has(id)).map(([, latency]) => latency);
  return { client: index + 1, received: delays.length, latencyMs: summary(delays), disconnects: stat.disconnects };
});
const report = { options, emitted: emitted.size, received: summary(clients.map(c => c.received)), latencyMs: summary(stats.flatMap(s => [...s.received].filter(([id]) => emitted.has(id)).map(([, ms]) => ms))), disconnects: clients.reduce((n, c) => n + c.disconnects, 0), allReceived: clients.every(c => c.received === options.emits), clients };
console.log(JSON.stringify(report, null, 2));
if (!report.allReceived || report.disconnects) process.exitCode = 1;
