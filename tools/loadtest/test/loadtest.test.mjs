import assert from 'node:assert/strict';
import { readFile, mkdtemp, readFile as read } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseArgs, runLoadTest } from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// A mock of the API's /changes (SSE) and /dev/emit; it only listens on 127.0.0.1.
async function startMock({ rejectAfter = Infinity } = {}) {
  const streams = new Set();
  let nextId = 1;
  let accepted = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/changes' && req.method === 'GET') {
      if (accepted++ >= rejectAfter) { res.writeHead(503).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': connected\n\n');
      streams.add(res);
      res.on('close', () => streams.delete(res));
      return;
    }
    if (req.url === '/dev/emit' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const id = nextId++;
        for (const stream of streams) stream.write(`id: ${id}\nevent: change\ndata: ${body}\n\n`);
        res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  return { url, close };
}

for (const clients of [50, 200]) {
  test(`ローカルで ${clients} 接続: 全件受信・切断 0`, async () => {
    const mock = await startMock();
    try {
      const report = await runLoadTest({ url: mock.url, clients, emits: 20, interval: 0, duration: 200, rampStep: clients, rampInterval: 0 });
      assert.equal(report.receivedTotal, clients * 20);
      assert.deepEqual(report.received, { median: 20, p95: 20, max: 20 });
      assert.equal(report.disconnects, 0);
      assert.equal(report.failures, 0);
      assert.equal(report.emitFailures, 0);
      assert.equal(report.allReceived, true);
      assert.ok(report.latencyMs.max >= 0);
    } finally { await mock.close(); }
  });
}

test('ramp-up: 段階ごとに接続し、残数は最後の段階にまとまる', async () => {
  const mock = await startMock();
  try {
    const report = await runLoadTest({ url: mock.url, clients: 70, emits: 3, interval: 0, duration: 100, rampStep: 30, rampInterval: 50 });
    assert.deepEqual(report.rampStages.map(s => [s.attempted, s.connected, s.failures]), [[30, 30, 0], [30, 30, 0], [10, 10, 0]]);
    assert.ok(report.rampStages[1].startedAtMs >= 40);
    assert.ok(report.rampStages[2].startedAtMs > report.rampStages[1].startedAtMs);
    assert.equal(report.allReceived, true);
  } finally { await mock.close(); }
});

test('接続失敗は集計に載り、全体は落ちない', async () => {
  const mock = await startMock({ rejectAfter: 8 });
  try {
    const report = await runLoadTest({ url: mock.url, clients: 10, emits: 2, interval: 0, duration: 100, rampStep: 5, rampInterval: 20 });
    assert.equal(report.connected, 8);
    assert.equal(report.failures, 2);
    assert.equal(report.disconnects, 2);
    assert.equal(report.allReceived, false);
    assert.equal(report.receivedTotal, 16);
  } finally { await mock.close(); }
});

test('引数の解析と検証', () => {
  assert.equal(parseArgs(['--clients', '400', '--ramp-step', '50']).rampStep, 50);
  assert.equal(parseArgs(['--clients', '7']).rampStep, 7);
  assert.equal(parseArgs(['--verbose']).verbose, true);
  assert.throws(() => parseArgs(['--clients', '0']));
  assert.throws(() => parseArgs(['--bogus', '1']));
});

function keyShape(value) {
  if (Array.isArray(value)) return value.length ? [keyShape(value[0])] : [];
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, keyShape(value[k])]));
  return 'v';
}
function readmeExample(readme, marker) {
  const after = readme.slice(readme.indexOf(`<!-- ${marker} -->`));
  return JSON.parse(/```json\n([\s\S]*?)\n```/.exec(after)[1]);
}

test('出力 JSON の形が README の例と一致する(--verbose の clients も)', async () => {
  const readme = await readFile(join(here, '..', 'README.md'), 'utf8');
  const mock = await startMock();
  try {
    const plain = await runLoadTest({ url: mock.url, clients: 2, emits: 2, interval: 0, duration: 50 });
    assert.deepEqual(keyShape(plain), keyShape(readmeExample(readme, 'report-example')));
    const verbose = await runLoadTest({ url: mock.url, clients: 2, emits: 2, interval: 0, duration: 50, verbose: true });
    assert.deepEqual(keyShape(verbose.clients[0]), keyShape(readmeExample(readme, 'client-example')));
    assert.equal(plain.clients, undefined);
  } finally { await mock.close(); }
});

test('CLI: --out に JSON を保存し、成功で終了コード 0', async () => {
  const mock = await startMock();
  try {
    const dir = await mkdtemp(join(tmpdir(), 'loadtest-'));
    const out = join(dir, 'r.json');
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(here, '..', 'sse.mjs'), '--url', mock.url, '--clients', '5', '--emits', '2', '--interval', '0', '--duration', '50', '--out', out], { stdio: 'ignore' });
      child.on('error', reject).on('close', resolve);
    });
    assert.equal(code, 0);
    assert.equal(JSON.parse(await read(out, 'utf8')).receivedTotal, 10);
  } finally { await mock.close(); }
});
