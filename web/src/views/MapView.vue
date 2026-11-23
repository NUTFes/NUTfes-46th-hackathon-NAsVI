<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import MapCanvas from '../map/MapCanvas.vue';
import FilterChips from '../components/FilterChips.vue';
import FilterBand from '../components/FilterBand.vue';
import { applyFilter } from '../domain/filter';
import { useAppTokens } from '../app/tokens';
import { usePosition } from '../services/position';
import { getStorage, type TagLink } from '../storage';
import { useLabelsStore, useLandmarksStore, usePlacesStore, useStampsStore } from '../stores';
import type { Destination, FilterState, MyTag } from '../types';
import type { MapState } from '../map/layers/types';

const root = ref<HTMLElement>();
const tokens = useAppTokens(root);
const route = useRoute();
const router = useRouter();
const places = usePlacesStore();
const stamps = useStampsStore();
const landmarks = useLandmarksStore();
const labels = useLabelsStore();
const { position, status } = usePosition();
const keyword = ref('');
const destination = ref<Destination | null>(null);
const filter = ref<FilterState>({ labelIds: [], tagIds: [] });
const tags = ref<MyTag[]>([]);
const links = ref<TagLink[]>([]);
const ready = ref(false);
const busy = ref(false);
const error = ref('');
const now = ref(Date.now());
const ticker = setInterval(() => { now.value = Date.now(); }, 1000);
onBeforeUnmount(() => clearInterval(ticker));
watch(() => route.fullPath, async (_path, _oldPath, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  keyword.value = typeof route.query.q === 'string' ? route.query.q : '';
  try {
    const storage = await getStorage();
    const [savedDestination, savedFilter, savedTags, savedLinks] = await Promise.all([
      storage.destination.get(), storage.filter.get(), storage.tags.list(), storage.tagLinks.list(),
    ]);
    if (!current) return;
    destination.value = savedDestination;
    filter.value = savedFilter;
    tags.value = savedTags;
    links.value = savedLinks;
    ready.value = true;
  } catch {
    if (current) error.value = '端末の情報を読み込めませんでした。画面を開き直してください。';
  }
}, { immediate: true });
const activeLabels = computed(() => [
  ...filter.value.labelIds.map(id => labels.items.find(item => item.id === id)?.title ?? '削除された種類'),
  ...filter.value.tagIds.map(id => tags.value.find(item => item.id === id)?.title ?? '削除されたタグ'),
]);
const filtered = computed(() => applyFilter(places.items, filter.value, links.value));
const count = computed(() => filtered.value.filter(place => place.kind === 'event' || place.kind === 'parking').length);
const state = computed<MapState>(() => ({
  places: filtered.value, stamps: stamps.items, landmarks: landmarks.items,
  position: position.value, destination: destination.value, filter: filter.value, now: now.value,
}));
async function saveFilter(value: FilterState) {
  if (!ready.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const storage = await getStorage();
    if (value.labelIds.length || value.tagIds.length) await storage.filter.save(value);
    else await storage.filter.clear();
    filter.value = value;
  } catch { error.value = '絞り込みを保存できませんでした。もう一度お試しください。'; }
  finally { busy.value = false; }
}
function search() {
  void router.push({ name: 'search', query: { q: [...keyword.value].slice(0, 50).join('') || undefined } });
}
function select(selection: { kind: 'place' | 'building'; id: string }) {
  void router.push({ name: selection.kind === 'building' ? 'building' : 'card', params: { id: selection.id } });
}
</script>

<template>
  <main ref="root" class="map-view" :style="tokens">
    <header class="map-view__controls">
      <h1>マップ</h1>
      <form class="app-search" role="search" @submit.prevent="search">
        <label><span>企画・場所を検索</span><input v-model="keyword" type="search" autocomplete="off" placeholder="企画・場所を検索"></label>
        <button type="submit" class="app-action">検索</button>
      </form>
      <fieldset :disabled="!ready || busy">
        <legend>場所の絞り込み</legend>
        <FilterChips :labels="labels.items" :tags="tags" :model-value="filter" @update:model-value="saveFilter" />
        <FilterBand :labels="activeLabels" :count="count" empty-hint="条件に合う場所がありません。絞り込みを解除して探せます。" @clear="saveFilter({ labelIds: [], tagIds: [] })" />
      </fieldset>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="map-view__actions">
        <RouterLink class="app-action" :to="{ name: 'stamp' }">スタンプを押す</RouterLink>
        <RouterLink v-if="destination" class="app-action" :to="{ name: 'guide' }">案内を見る</RouterLink>
        <RouterLink v-if="!position" class="app-action" :to="{ name: 'noloc' }">
          {{ status === 'asking' ? '現在地を確認しています' : status === 'idle' ? '現在地の利用を選ぶ' : '現在地が使えません・位置の設定を確認する' }}
        </RouterLink>
      </div>
    </header>
    <div class="map-view__canvas"><MapCanvas :state="state" @select="select" /></div>
    <p class="map-view__credit">© OpenStreetMap contributors (ODbL)</p>
  </main>
</template>
