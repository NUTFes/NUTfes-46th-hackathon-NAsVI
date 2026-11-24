import { readonly, ref } from 'vue';
import { loadCachedOrFetch } from '../sync/bootstrap';
import { createSyncOrchestrator, type OrchestratorOptions } from '../sync/orchestrator';

export function createAppSync(options: OrchestratorOptions = {}) {
  const hasSnapshot = ref(false);
  const deps = { loadCachedOrFetch, ...options.dependencies };
  const orchestrator = createSyncOrchestrator({
    ...options,
    dependencies: {
      ...options.dependencies,
      async loadCachedOrFetch(cacheOptions) {
        const cached = await deps.loadCachedOrFetch(cacheOptions);
        hasSnapshot.value = true;
        return cached;
      },
    },
  });
  return { ...orchestrator, hasSnapshot: readonly(hasSnapshot) };
}
