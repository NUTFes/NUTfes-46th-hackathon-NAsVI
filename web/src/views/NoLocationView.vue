<!-- 地図の上に重ねる帯。地図・router への結線は別タスクのため、ここでは配置を変更しない。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { usePosition } from '../services/position';

const { allow, refuse, status } = usePosition();

const headings = {
  idle: '現在地の利用を選べます',
  asking: '位置情報の許可を確認しています',
  granted: '',
  denied: '現在地の利用が許可されていません',
  unavailable: '現在地を取得できません',
  timeout: '現在地の取得に時間がかかっています',
} as const;
const failed = computed(() => ['denied', 'unavailable', 'timeout'].includes(status.value));

function requestPosition() {
  // 一時エラー後もサービスの監視は続く。明示的な再試行では監視を解放して取り直す。
  if (status.value === 'timeout' || status.value === 'unavailable') refuse();
  allow();
}

// design-system/tokens.json の color.{dark,light}。
// 値は design-system/claude-design/tokens.css の解決済み値。
const colors = {
  '--noloc-border': { dark: '#f87171', light: '#dc2626' }, // color.{dark,light}.danger
  '--noloc-background': { dark: '#2d1520', light: '#fef2f2' }, // color.{dark,light}.danger-bg
  '--noloc-text': { dark: '#fecaca', light: '#b91c1c' }, // color.{dark,light}.danger-text
  '--noloc-heading': { dark: '#f4f0ff', light: '#1e0b3a' }, // color.{dark,light}.text-primary
  '--noloc-action': { dark: '#a78bfa', light: '#6d28d9' }, // color.{dark,light}.action-primary
  '--noloc-on-action': { dark: '#1e0b3a', light: '#ffffff' }, // color.{dark,light}.action-on-primary
  '--noloc-pressed': { dark: '#ffffff1f', light: '#1e0b3a14' }, // color.{dark,light}.state-pressed
} as const;
const root = ref<HTMLElement | null>(null);
const theme = ref<'dark' | 'light'>('dark');
const colorStyle = computed(() => Object.fromEntries(
  Object.entries(colors).map(([name, values]) => [name, values[theme.value]]),
));
let themeObserver: MutationObserver | undefined;
onMounted(() => {
  const resolveColors = () => {
    theme.value = root.value?.closest('[data-theme]')?.getAttribute('data-theme') === 'light'
      ? 'light' : 'dark';
  };
  resolveColors();
  themeObserver = new MutationObserver(resolveColors);
  // 最寄りテーマの変更・追加・削除を追う。コンテンツの更新は監視しない。
  for (let element = root.value; element; element = element.parentElement) {
    themeObserver.observe(element, { attributes: true, attributeFilter: ['data-theme'] });
  }
});
onUnmounted(() => themeObserver?.disconnect());
</script>

<template>
  <main ref="root" class="no-location" :style="colorStyle">
    <!-- 領域を常駐させ、asking → denied 等でも変更後の内容を通知する。 -->
    <div role="status" aria-live="polite" aria-atomic="true">
      <section v-if="status !== 'granted'" class="no-location__banner">
        <span class="no-location__icon" aria-hidden="true">{{ failed ? '!' : 'i' }}</span>
        <div class="no-location__content">
          <h1>{{ headings[status] }}</h1>
          <p v-if="status === 'idle'">位置を利用すると、行き先への方角と距離、スタンプを使えます。</p>
          <p v-else-if="status === 'asking'">端末やブラウザの許可画面を確認してください。現在地の取得を待っています。</p>
          <template v-else>
            <p>行き先への方角と距離、スタンプは使えません。</p>
            <template v-if="status === 'denied'">
              <p>再依頼ボタンを押しても、許可画面が再表示されず反応がない場合があります。その場合は端末やブラウザの設定で許可を変更してください。</p>
              <p>iOS（Safari）:「設定」→「プライバシーとセキュリティ」→「位置情報サービス」をオンにし、「SafariのWebサイト」で使用中の位置情報を許可してください。</p>
              <p>Android（Chrome）:「設定」→「位置情報」→「アプリの権限」→「Chrome」で位置情報を許可してください。Chrome のこのサイトのアドレスバー左側→「権限」でも位置情報を許可してください。</p>
              <p>設定の項目名は端末やバージョンによって異なります。変更後、このページに戻って再依頼してください。</p>
            </template>
            <p v-else-if="status === 'unavailable'">端末の位置情報がオンか確認し、電波の届きやすい場所で試してください。</p>
            <p v-else-if="status === 'timeout'">電波の届きやすい場所で、もう一度試してください。</p>
          </template>
          <p>検索・一覧・場所の情報は、このまま使えます。</p>
          <!-- 「地図で指定する」は wireframe.md の OQ-2 が未決のため実装しない。 -->
          <button type="button" :disabled="status === 'asking'" @click="requestPosition">
            {{ status === 'asking' ? '確認中…' : status === 'timeout' || status === 'unavailable' ? 'もう一度試す' : '位置の利用を許可' }}
          </button>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.no-location {
  /* design-system/tokens.json */
  --noloc-space-small: 4px; /* space.1 */
  --noloc-space-medium: 8px; /* space.2 */
  --noloc-space-large: 16px; /* space.4 */
  --noloc-radius: 12px; /* radius.lg */
  --noloc-target: 44px; /* size.touch-target */
  --noloc-font: 'Noto Sans JP', sans-serif; /* font.family.base。外部から読み込まない。 */
  --noloc-body-size: 13px; /* font.size.sm */
  --noloc-heading-size: 15px; /* font.size.lg */
  --noloc-action-size: 14px; /* font.size.md */
  --noloc-regular: 400; /* font.weight.regular */
  --noloc-bold: 800; /* font.weight.extra-bold */
  /* design-system/claude-design/tokens.json: type.groups[].styles */
  --noloc-body-line-height: 1.5; /* body.lineHeight */
  --noloc-heading-line-height: 1.35; /* subtitle.lineHeight (Banner 見出しは太さ 800) */
  --noloc-action-line-height: 1.4; /* action.lineHeight */

  padding: var(--noloc-space-large);
  font-family: var(--noloc-font);
  font-size: var(--noloc-body-size);
  line-height: var(--noloc-body-line-height);
  font-weight: var(--noloc-regular);
}

.no-location__banner {
  display: flex;
  align-items: flex-start;
  gap: var(--noloc-space-large);
  padding: var(--noloc-space-large);
  border: thin solid var(--noloc-border);
  border-radius: var(--noloc-radius);
  background: var(--noloc-background);
  color: var(--noloc-text);
}

.no-location__icon {
  color: var(--noloc-border);
  font-size: var(--noloc-heading-size);
  font-weight: var(--noloc-bold);
}

.no-location__content {
  min-width: 0;
  overflow-wrap: anywhere;
}

h1, p {
  margin: 0;
}

h1 {
  margin-bottom: var(--noloc-space-small);
  color: var(--noloc-heading);
  font-size: var(--noloc-heading-size);
  line-height: var(--noloc-heading-line-height);
  font-weight: var(--noloc-bold);
}

button {
  min-width: var(--noloc-target);
  min-height: var(--noloc-target);
  margin-top: var(--noloc-space-medium);
  padding: var(--noloc-space-medium) var(--noloc-space-large);
  border: 0;
  border-radius: var(--noloc-radius);
  background: var(--noloc-action);
  color: var(--noloc-on-action);
  font: inherit;
  font-size: var(--noloc-action-size);
  line-height: var(--noloc-action-line-height);
  font-weight: var(--noloc-bold);
  cursor: pointer;
}

button:active {
  background-image: linear-gradient(var(--noloc-pressed), var(--noloc-pressed));
}

button:focus-visible {
  outline: solid var(--noloc-action);
  outline-offset: var(--noloc-space-small);
}
</style>
