import { inject, provide, readonly, shallowRef, type InjectionKey } from 'vue';

function createAdminFeedback() {
  const error = shallowRef<unknown>(null);
  return {
    error: readonly(error),
    reportError(reason: unknown) { error.value = reason; },
    clearError() { error.value = null; },
  };
}

const adminFeedbackKey: InjectionKey<ReturnType<typeof createAdminFeedback>> = Symbol('admin-feedback');

/** AdminLayout のインスタンスごとに作り、運営画面を離れたら破棄する。 */
export function provideAdminFeedback() {
  const feedback = createAdminFeedback();
  provide(adminFeedbackKey, feedback);
  return feedback;
}

/**
 * 子画面では API 呼び出しの catch で reportError(error) を呼ぶ。
 * 成功時・再試行前には clearError() を呼ぶ。業務データは既存 stores/ を使う。
 * 中断したリクエストは失敗として表示しないため、呼び出し側で判別する。
 */
export function useAdminFeedback() {
  const feedback = inject(adminFeedbackKey);
  if (!feedback) throw new Error('useAdminFeedback は AdminLayout の子画面で使ってください');
  return feedback;
}
