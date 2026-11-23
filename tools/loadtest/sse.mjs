import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, isAbsolute } from 'node:path';
import { parseArgs, runLoadTest } from './lib.mjs';

try {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.out) {
    const inside = dir => { const r = relative(dir, resolve(parsed.out)); return !r.startsWith('..') && !isAbsolute(r); };
    if (!inside('/tmp') && !inside(tmpdir())) console.error('warning: --out is not under /tmp; do not commit results that came from a real deployment');
  }
  const report = await runLoadTest(parsed);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json.trimEnd());
  if (report.options.out) await writeFile(report.options.out, json, 'utf8');
  if (!report.allReceived || report.disconnects || report.emitFailures || report.missing || report.orderViolations) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
