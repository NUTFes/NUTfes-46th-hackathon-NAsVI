<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
const events = ref<{id: string; type: string; data: string}[]>([]);
const status = ref('接続中');
let source: EventSource;
function connect() {
  source = new EventSource('/changes');
  source.onopen = () => { status.value = '接続済み'; };
  source.onerror = () => { status.value = '再接続待ち'; };
  for (const type of ['stampPressed', 'stampRetracted', 'placeAdded', 'placeUpdated', 'placeRemoved', 'appVersionChanged']) {
    source.addEventListener(type, (event: MessageEvent) => {
      events.value.unshift({ id: event.lastEventId, type, data: event.data });
      events.value = events.value.slice(0, 200);
    });
  }
  source.addEventListener('resync', () => {
    source.close();
    events.value = [];
    // 一覧 API は今回の範囲外。試作では履歴を捨て、現在から購読し直す。
    connect();
    status.value = 'resync: 一覧の再取得は未実装。現在から再接続';
  });
}
onMounted(connect);
onUnmounted(() => source?.close());
</script>
<template>
  <main><h1>Hub の出来事</h1><p>{{ status }}</p><p>受信した直近200件。地図・一覧APIは未実装です。</p>
    <ol><li v-for="(event, index) in events" :key="`${event.id}-${index}`"><strong>{{ event.id }} / {{ event.type }}</strong><pre>{{ event.data }}</pre></li></ol>
  </main>
</template>
<style>body{font-family:system-ui;margin:2rem;max-width:960px}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{border-bottom:1px solid #ddd;padding:1rem}</style>
