<!-- 地図の上に重ねる帯。地図・router への結線は別タスクのため、ここでは配置を変更しない。 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAppTokens } from '../app/tokens';
import Banner from '../components/ui/Banner.vue';
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

const root = ref<HTMLElement>();
const tokens = useAppTokens(root); // 色・寸法は I-0 の --app-*（テーマ追従を含む）
const icon = computed(() => (failed.value ? 'alert' : 'info') as 'alert' | 'info');
const body = computed(() => {
  switch (status.value) {
    case 'idle': return '位置を利用すると、行き先への方角と距離、スタンプを使えます。\n検索・一覧・場所の情報は、このまま使えます。';
    case 'asking': return '端末やブラウザの許可画面を確認してください。現在地の取得を待っています。\n検索・一覧・場所の情報は、このまま使えます。';
    default: return [
      '行き先への方角と距離、スタンプは使えません。',
      ...(status.value === 'denied' ? [
        '再依頼ボタンを押しても、許可画面が再表示されず反応がない場合があります。その場合は端末やブラウザの設定で許可を変更してください。',
        'iOS（Safari）:「設定」→「プライバシーとセキュリティ」→「位置情報サービス」をオンにし、「SafariのWebサイト」で使用中の位置情報を許可してください。',
        'Android（Chrome）:「設定」→「位置情報」→「アプリの権限」→「Chrome」で位置情報を許可してください。Chrome のこのサイトのアドレスバー左側→「権限」でも位置情報を許可してください。',
        '設定の項目名は端末やバージョンによって異なります。変更後、このページに戻って再依頼してください。',
      ] : status.value === 'unavailable' ? ['端末の位置情報がオンか確認し、電波の届きやすい場所で試してください。']
        : ['電波の届きやすい場所で、もう一度試してください。']),
      '検索・一覧・場所の情報は、このまま使えます。',
    ].join('\n');
  }
});
const actionLabel = computed(() => status.value === 'asking' ? '確認中…'
  : status.value === 'timeout' || status.value === 'unavailable' ? 'もう一度試す' : '位置の利用を許可');

</script>

<template>
  <main ref="root" class="no-location" :style="tokens">
    <!-- 領域を常駐させ、asking → denied 等でも変更後の内容を通知する。 -->
    <div role="status" aria-live="polite" aria-atomic="true">
      <!-- 「地図で指定する」は wireframe.md の OQ-2 が未決のため実装しない。 -->
      <h1 v-if="status !== 'granted'" class="sr-only">{{ headings[status] }}</h1>
      <!-- 外側の role=status が通知を担う。Banner 既定の role=alert は上書きし、二重読み上げを避ける。 -->
      <Banner
        v-if="status !== 'granted'"
        role="group"
        class="no-location__banner"
        :title="headings[status]"
        :body="body"
        :icon="icon"
        :actions="[{ label: actionLabel, disabled: status === 'asking', onPress: requestPosition }]"
      />
    </div>
  </main>
</template>

<style scoped>
.no-location {
  padding: var(--app-space-4);
  font-family: var(--app-font);
  font-size: var(--app-body);
  line-height: var(--app-leading);
  color: var(--app-text-primary);
}
/* 本文は段落ごとに改行して並べる（Banner の body は 1 つの文字列） */
.no-location__banner :deep(.nv-banner__body) { white-space: pre-line; overflow-wrap: anywhere; }
.no-location__banner :deep(.nv-banner__actions) { margin-top: var(--app-space-2); }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
