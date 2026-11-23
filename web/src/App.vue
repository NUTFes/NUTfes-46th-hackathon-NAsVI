<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import MapView from './views/MapView.vue';
import VisitorList from './app/VisitorList.vue';
import { createAppSync } from './app/sync';
import { useAppTokens } from './app/tokens';
import { useChangesStore, usePlacesStore } from './stores';
import { usePosition } from './services/position';
import './app/app.css';

const root = ref<HTMLElement>();
const tokens = useAppTokens(root);
const route = useRoute();
const router = useRouter();
const places = usePlacesStore();
const changes = useChangesStore();
// 経路をまたいで位置サービスを保持する。許可要求・位置の送信はしない。
const { status } = usePosition();
const sync = createAppSync();
const started = ref(false);
const retrying = ref(false);
const emptyState = ref<'loading' | 'ready' | 'failed'>('loading');
const placesFailed = computed(() => sync.state.failedKeys.includes('places')
  || (sync.state.failedKeys.length === 0 && !!sync.state.error));
function settle() {
  // 他一覧の失敗による error を places の失敗にしない。0件成功も利用可能。
  emptyState.value = placesFailed.value ? 'failed' : 'ready';
}
void sync.start().then(() => { started.value = true; settle(); });
watch(() => sync.state.syncing, syncing => {
  if (!syncing && started.value) settle();
});
const availability = computed(() => places.items.length > 0 ? 'ready' : emptyState.value);
const admin = computed(() => route.path === '/admin' || route.path.startsWith('/admin/'));
const mapScene = computed(() => ['map', 'search', 'card', 'tags', 'guide', 'stamp', 'building'].includes(String(route.name)));
const needsPlaces = computed(() => ['map', 'list', 'search', 'card', 'guide', 'tags', 'building'].includes(String(route.name)));
const blocked = computed(() => needsPlaces.value && availability.value !== 'ready');
const tab = computed(() => route.name === 'list' ? 'list' : route.name === 'camera' ? 'camera' : 'map');

async function retry() {
  if (retrying.value || sync.state.syncing) return;
  retrying.value = true;
  try {
    if (sync.state.failedKeys.length) await sync.refresh([...sync.state.failedKeys]);
    else await sync.resync();
    settle();
  } finally { retrying.value = false; }
}
function reload() { window.location.reload(); }
watch(status, value => {
  if (route.name === 'noloc' && value === 'granted') void router.replace({ name: 'map' });
});
onBeforeUnmount(() => sync.close());
</script>

<template>
  <div ref="root" :style="tokens" :class="{ 'visitor-app': !admin }">
    <RouterView v-if="admin" />
    <template v-else>
      <section v-if="changes.versionChanged" class="app-banner" role="alert" aria-label="アプリの更新">
        <p>新しいバージョンがあります。画面を再読み込みしてください。</p>
        <button type="button" class="app-action" @click="reload">再読み込み</button>
        <button type="button" class="app-action" @click="changes.acknowledgeVersionChange">あとで</button>
      </section>
      <section v-if="started && (placesFailed || retrying)" class="app-banner" role="alert" aria-label="場所の取得失敗">
        <p>{{ places.items.length ? '場所を更新できませんでした。保存済みの情報を表示しています。' : '場所を読み込めませんでした。' }}</p>
        <template v-if="!sync.hasSnapshot.value && !sync.state.failedKeys.length">
          <p>画面を再読み込みして、もう一度お試しください。</p>
          <button type="button" class="app-action" @click="reload">再読み込み</button>
        </template>
        <button v-else type="button" class="app-action" :disabled="retrying || sync.state.syncing" @click="retry">
          {{ retrying || sync.state.syncing ? '再試行中…' : 'もう一度読み込む' }}
        </button>
      </section>
      <div class="visitor-stage">
        <p v-if="blocked && availability === 'loading'" class="app-loading" role="status">場所を読み込んでいます</p>
        <template v-if="!blocked">
          <div v-if="mapScene" class="visitor-map" :inert="route.name !== 'map'">
            <MapView />
          </div>
          <div v-if="route.name !== 'map'" :class="{ 'visitor-overlay': mapScene }">
            <RouterView v-slot="{ Component }">
              <VisitorList v-if="route.name === 'list' || route.name === 'search'" :key="String(route.name)" :search-mode="route.name === 'search'" />
              <component :is="Component" v-else />
            </RouterView>
          </div>
        </template>
      </div>
      <nav class="visitor-tabs" aria-label="表示を切り替える">
        <RouterLink v-for="item in [{ name: 'list', label: '一覧' }, { name: 'map', label: 'マップ' }, { name: 'camera', label: 'カメラ' }]"
          :key="item.name" :to="{ name: item.name }" :aria-current="tab === item.name ? 'page' : undefined">
          {{ item.label }}
        </RouterLink>
      </nav>
    </template>
  </div>
</template>
