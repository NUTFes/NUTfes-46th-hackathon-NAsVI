import { writeFile } from 'node:fs/promises';
import { parseArgs, runLoadTest } from './lib.mjs';

try {
  const report = await runLoadTest(parseArgs(process.argv.slice(2)));
  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(json.trimEnd());
  if (report.options.out) await writeFile(report.options.out, json, 'utf8');
  if (!report.allReceived || report.disconnects || report.emitFailures) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
