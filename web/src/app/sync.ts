import { readonly, ref } from 'vue';
import { bootstrap, loadCachedOrFetch, retryBootstrap } from '../sync/bootstrap';
import { createSyncOrchestrator, type OrchestratorOptions } from '../sync/orchestrator';
import type { CacheKey } from '../sync/cache';

/** W-09 の公開 API に refresh がない間の結線用アダプター。差し替え・参照整理は W-09 に任せる。 */
export function createAppSync(options: OrchestratorOptions = {}) {
  const hasSnapshot = ref(false);
  let retryKeys: CacheKey[] | undefined;
  const deps = { bootstrap, loadCachedOrFetch, ...options.dependencies };
  const orchestrator = createSyncOrchestrator({
    ...options,
    dependencies: {
      ...options.dependencies,
      async loadCachedOrFetch(cacheOptions) {
        const cached = await deps.loadCachedOrFetch(cacheOptions);
        hasSnapshot.value = true;
        return cached;
      },
      bootstrap: cacheOptions => retryKeys
        ? retryBootstrap(retryKeys, cacheOptions) : deps.bootstrap(cacheOptions),
    },
  });
  async function refresh(keys: readonly CacheKey[]) {
    retryKeys = [...keys];
    try { await orchestrator.resync(); }
    finally { retryKeys = undefined; }
  }
  return { ...orchestrator, hasSnapshot: readonly(hasSnapshot), refresh };
}
