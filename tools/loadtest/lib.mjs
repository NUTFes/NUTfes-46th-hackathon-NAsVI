import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

const defaults = {
  url: 'http://127.0.0.1:8787', clients: 50, emits: 20, interval: 100, duration: 5000,
  rampStep: null, rampInterval: 1000, timeout: 15000, out: null, verbose: false,
};
const flags = {
  '--url': 'url', '--clients': 'clients', '--emits': 'emits', '--interval': 'interval',
  '--duration': 'duration', '--ramp-step': 'rampStep', '--ramp-interval': 'rampInterval',
  '--timeout': 'timeout', '--out': 'out',
};

function normalizeOptions(input) {
  const options = { ...defaults, ...input };
  options.rampStep ??= options.clients;
  const url = new URL(options.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid url: use http or https');
  for (const key of ['clients', 'emits', 'interval', 'duration', 'rampStep', 'rampInterval', 'timeout']) {
    const min = ['interval', 'rampInterval'].includes(key) ? 0 : 1;
    if (!Number.isSafeInteger(options[key]) || options[key] < min) throw new Error(`Invalid ${key}`);
  }
  for (const key of ['interval', 'duration', 'rampInterval', 'timeout']) {
    if (options[key] > 2 ** 31 - 1) throw new Error(`Invalid ${key}: timer too large`);
  }
  if (options.out !== null && (typeof options.out !== 'string' || !options.out.trim())) throw new Error('Invalid out');
  if (typeof options.verbose !== 'boolean') throw new Error('Invalid verbose');
  return options;
}

export function parseArgs(args) {
  const input = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verbose') { input.verbose = true; continue; }
    const key = flags[args[i]];
    const value = args[++i];
    if (!key || value === undefined || value.startsWith('--')) {
      throw new Error('Arguments: --url --clients --emits --interval --duration --ramp-step --ramp-interval --timeout --out <value>, --verbose');
    }
    input[key] = ['url', 'out'].includes(key) ? value : (value.trim() ? Number(value) : NaN);
  }
  return normalizeOptions(input);
}

export function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { median: at(0.5), p95: at(0.95), max: at(1) };
}

// Retain the prototype's origin-relative /changes and /dev/emit URLs.
export async function runLoadTest(input = {}) {
  const options = normalizeOptions(input);
  const stats = Array.from({ length: options.clients }, () => ({
    connected: false, received: new Map(), disconnects: 0, error: null,
  }));
  const controllers = [];
  const tasks = [];
  const stages = [];
  const emitted = new Set();
  const sentTimes = new Set();
  const started = performance.now();
  let stopping = false;
  let emitAttempts = 0;
  let emitFailures = 0;

  function startClient(index) {
    let settle;
    const ready = new Promise(resolve => { settle = resolve; });
    const stat = stats[index];
    const controller = new AbortController();
    controllers.push(controller);
    // Covers headers AND the first SSE chunk, including a server that never becomes ready.
    const timer = setTimeout(() => controller.abort(), options.timeout);
    const task = (async () => {
      let reader;
      try {
        const response = await fetch(new URL('/changes', options.url), {
          signal: controller.signal, redirect: 'manual',
        });
        if (!response.ok) throw new Error(`SSE HTTP ${response.status}`);
        if (response.headers.get('content-type')?.split(';')[0].trim() !== 'text/event-stream') {
          throw new Error('SSE content-type must be text/event-stream');
        }
        reader = response.body.getReader();
        let chunk = await reader.read();
        if (chunk.done) throw new Error('SSE closed before ready');
        clearTimeout(timer);
        stat.connected = true;
        settle(true);
        const decoder = new TextDecoder();
        let buffer = '';
        while (!chunk.done) {
          // Normalize after concatenation so a CRLF split across chunks also works.
          buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let id;
            const data = [];
            for (const line of frame.split('\n')) {
              const colon = line.indexOf(':');
              const field = colon < 0 ? line : line.slice(0, colon);
              const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
              if (field === 'id' && /^\d+$/.test(value)) id = Number(value);
              if (field === 'data') data.push(value);
            }
            if (Number.isSafeInteger(id) && data.length) {
              const payload = JSON.parse(data.join('\n'));
              if (payload && sentTimes.has(payload.sentAt) && !stat.received.has(id)) {
                stat.received.set(id, Date.now() - payload.sentAt);
              }
            }
          }
          chunk = await reader.read();
        }
        throw new Error('SSE stream closed');
      } catch (error) {
        if (!stopping) {
          stat.disconnects++;
          stat.error = error.message;
        }
      } finally {
        clearTimeout(timer);
        settle(stat.connected);
        controller.abort();
        reader?.releaseLock();
      }
    })();
    tasks.push(task);
    return ready;
  }

  try {
    const readiness = [];
    for (let offset = 0; offset < options.clients; offset += options.rampStep) {
      const attempted = Math.min(options.rampStep, options.clients - offset);
      const stage = {
        stage: stages.length + 1, startedAtMs: Math.round(performance.now() - started),
        attempted, connected: 0, failures: 0,
      };
      stages.push(stage);
      const batch = Array.from({ length: attempted }, (_, i) => startClient(offset + i));
      readiness.push(Promise.all(batch).then(results => {
        stage.connected = results.filter(Boolean).length;
        stage.failures = attempted - stage.connected;
      }));
      // Start batches independently of earlier handshake completion.
      if (offset + attempted < options.clients) await sleep(options.rampInterval);
    }
    await Promise.all(readiness);

    for (let i = 0; i < options.emits; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeout);
      emitAttempts++;
      const sentAt = Date.now();
      sentTimes.add(sentAt);
      try {
        const response = await fetch(new URL('/dev/emit', options.url), {
          method: 'POST', redirect: 'manual', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sentAt }),
        });
        if (response.status !== 201) throw new Error(`emit HTTP ${response.status}`);
        const change = await response.json();
        if (!Number.isSafeInteger(change.id) || change.id < 1 || emitted.has(change.id)) {
          throw new Error('emit response must contain a unique positive integer id');
        }
        emitted.add(change.id);
      } catch {
        emitFailures++;
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
      if (i + 1 < options.emits) await sleep(options.interval);
    }
    // Observe for the entire duration, even when all messages have already arrived.
    await sleep(options.duration);
  } finally {
    stopping = true;
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(tasks);
  }

  const delays = stats.map(stat => [...stat.received]
    .filter(([id]) => emitted.has(id)).map(([, latency]) => latency));
  const clients = stats.map((stat, i) => ({
    client: i + 1, connected: stat.connected, received: delays[i].length,
    latencyMs: summary(delays[i]), disconnects: stat.disconnects, error: stat.error,
  }));
  const connected = clients.filter(client => client.connected).length;
  return {
    options, emitted: emitted.size, emitAttempts, emitFailures, connected,
    failures: options.clients - connected,
    receivedTotal: clients.reduce((n, client) => n + client.received, 0),
    received: summary(clients.map(client => client.received)), latencyMs: summary(delays.flat()),
    disconnects: clients.reduce((n, client) => n + client.disconnects, 0),
    allReceived: emitted.size === options.emits && clients.every(client => client.connected && client.received === options.emits),
    rampStages: stages,
    ...(options.verbose ? { clients } : {}),
  };
}
