export interface CoverageResult {
  operationId: string;
  outcome: 'validated' | 'unimplemented' | 'skipped';
}

export function reportCoverage(results: readonly CoverageResult[], log: (message: string) => void = console.log) {
  const unimplemented = results.filter(item => item.outcome === 'unimplemented').map(item => item.operationId);
  const skipped = results.filter(item => item.outcome === 'skipped').map(item => item.operationId);
  const validated = results.filter(item => item.outcome === 'validated').length;
  log(`契約テスト: 未実装 ${unimplemented.length} 件 [${unimplemented.join(', ')}]`);
  log(`契約テスト: 検証済み ${validated} 件、skipped ${skipped.length} 件 [${skipped.join(', ')}] (SSE は対象外)`);
  return { validated, unimplemented, skipped };
}
