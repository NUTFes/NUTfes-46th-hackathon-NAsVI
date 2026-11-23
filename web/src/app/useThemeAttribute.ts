import { onBeforeUnmount, onMounted, type Ref } from 'vue';

const QUERY = '(prefers-color-scheme: light)';

/**
 * OS の配色設定（prefers-color-scheme）に data-theme（dark / light）を追従させ、
 * 来場者アプリの最上位の要素に書き込む（figma-diff.md 決定 4）。
 * ライトでなければ dark（既定）。matchMedia が無い環境でも dark にする。
 */
export function useThemeAttribute(target: Ref<HTMLElement | undefined>) {
  let query: MediaQueryList | undefined;
  const apply = () => {
    target.value?.setAttribute('data-theme', query?.matches ? 'light' : 'dark');
  };
  onMounted(() => {
    query = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : undefined;
    apply();
    query?.addEventListener('change', apply);
  });
  onBeforeUnmount(() => query?.removeEventListener('change', apply));
}
