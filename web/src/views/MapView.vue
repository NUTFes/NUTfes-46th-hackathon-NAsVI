<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import SearchField from '../components/ui/SearchField.vue';
import Sheet from '../components/ui/Sheet.vue';
import DestinationBar from '../components/map/DestinationBar.vue';
import StampFab from '../components/map/StampFab.vue';
import MapEyeButton from '../components/map/MapEyeButton.vue';
import MapZoomButtons from '../components/map/MapZoomButtons.vue';
import MapLocateButton from '../components/map/MapLocateButton.vue';
import { distanceM } from '../domain/geo';
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

const searchField = ref<InstanceType<typeof SearchField>>();
async function focusSearch() {
  await nextTick();
  (searchField.value?.$el as HTMLElement | undefined)?.querySelector<HTMLInputElement>('input')?.focus();
}
const map = ref<InstanceType<typeof MapCanvas>>();
const zoomLimits = ref({ zoomInDisabled: false, zoomOutDisabled: false });
const eye = ref<InstanceType<typeof MapEyeButton>>();
const marksDialog = ref<HTMLDialogElement>();
const shown = ref({ event: true, facility: true, parking: true, stamps: true, landmarks: true });
const markOptions = [
  { key: 'event', label: '企画' }, { key: 'facility', label: '設備' },
  { key: 'parking', label: '駐車場' }, { key: 'stamps', label: 'スタンプ' },
  { key: 'landmarks', label: 'ランドマーク' },
] as const;
function openMarks() {
  marksDialog.value?.showModal();
  marksDialog.value?.focus();
}
function closeMarks() { marksDialog.value?.close(); }
function restoreEyeFocus() { (eye.value?.$el as HTMLButtonElement | undefined)?.focus(); }
const root = ref<HTMLElement>();
const tokens = useAppTokens(root);
const route = useRoute();
const router = useRouter();
watch(() => route.fullPath, () => { marksDialog.value?.close(); });
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
  places: filtered.value.filter(place => shown.value[place.kind === 'event' ? 'event' : place.kind === 'parking' ? 'parking' : 'facility']),
  stamps: shown.value.stamps ? stamps.items : [], landmarks: shown.value.landmarks ? landmarks.items : [],
  position: position.value, destination: destination.value, filter: filter.value, now: now.value,
}));
const destinationPlace = computed(() => places.items.find(place => place.id === destination.value?.placeId));
const remainingM = computed(() => position.value && destinationPlace.value
  ? distanceM(position.value, destinationPlace.value.location) : undefined);
async function stopDestination() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const storage = await getStorage();
    await storage.destination.clear();
    destination.value = null;
  } catch { error.value = '案内を終えられませんでした。もう一度お試しください。'; }
  finally { busy.value = false; }
}
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
    <h1 class="sr-only">マップ</h1>
    <div class="map-view__canvas"><MapCanvas ref="map" :state="state" @select="select" @zoom-limits="zoomLimits = $event" /></div>
    <header class="map-view__controls">
      <form role="search" @submit.prevent="search">
        <SearchField ref="searchField" v-model="keyword" @clear="focusSearch" />
        <button class="sr-only" type="submit">検索</button>
      </form>
      <fieldset :disabled="!ready || busy">
        <legend class="sr-only">場所の絞り込み</legend>
        <FilterChips :labels="labels.items" :tags="tags" :model-value="filter" @update:model-value="saveFilter" />
        <FilterBand :labels="activeLabels" :count="count" empty-hint="条件に合う場所がありません。絞り込みを解除して探せます。" @clear="saveFilter({ labelIds: [], tagIds: [] })" />
      </fieldset>
      <p v-if="error" role="alert">{{ error }}</p>
      <RouterLink v-if="!position" class="app-action" :to="{ name: 'noloc' }">
        {{ status === 'asking' ? '現在地を確認しています' : status === 'idle' ? '現在地の利用を選ぶ' : '現在地が使えません・位置の設定を確認する' }}
      </RouterLink>
      <DestinationBar v-if="destination" :place-name="destinationPlace?.name ?? '行き先'" :remaining-m="remainingM" :stopping="busy" @stop="stopDestination" />
    </header>
    <div class="map-view__tools">
      <MapEyeButton ref="eye" @press="openMarks" />
      <MapZoomButtons v-bind="zoomLimits" @zoom-in="map?.zoomBy(1)" @zoom-out="map?.zoomBy(-1)" />
      <MapLocateButton :disabled="!position" :label="position ? '現在地へ戻る' : '現在地へ戻る、現在地が使えません'" @press="map?.flyTo()" />
    </div>
    <StampFab class="map-view__stamp" :disabled="!position" :label="position ? 'スタンプを押す' : 'スタンプを押す、現在地が使えません'" @press="router.push({ name: 'stamp' })" />
    <p class="map-view__credit">© OpenStreetMap contributors (ODbL)</p>
    <dialog ref="marksDialog" class="map-view__dialog" tabindex="-1" aria-label="表示する印を選ぶ" @cancel.prevent="closeMarks" @close="restoreEyeFocus" @click.self="closeMarks">
      <Sheet title="表示する印を選ぶ" @close="closeMarks">
        <label v-for="option in markOptions" :key="option.key" class="map-view__check">
          <input v-model="shown[option.key]" type="checkbox">{{ option.label }}
        </label>
      </Sheet>
    </dialog>
  </main>
</template>

<style scoped>
.map-view { --map-bottom-clearance: calc(var(--map-tab-reserve, 0px) + env(safe-area-inset-bottom, 0px)); position: relative; display: block; height: 100%; min-height: 280px; isolation: isolate; }
/* TabBar が stage の外にある現在は 0。地図に重ねる場合は --map-tab-reserve を調整する。 */
.map-view__canvas { position: absolute; inset: 0; min-height: 0; }
.map-view__controls { position: absolute; top: 0; left: 0; right: 0; display: grid; gap: 8px; padding: max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) 12px max(12px, env(safe-area-inset-left, 0px)); pointer-events: none; }
.map-view__controls > * { pointer-events: auto; }
.map-view__controls form { margin: 0; }
.map-view__controls :deep(.nv-search) { width: 100%; }
.map-view__controls fieldset { display: grid; gap: 8px; }
.map-view__controls p[role='alert'] { margin: 0; padding: 8px; background: var(--app-bg-surface); }
.map-view__tools { position: absolute; right: max(12px, env(safe-area-inset-right, 0px)); bottom: calc(var(--map-bottom-clearance) + 108px); display: grid; gap: 8px; }
.map-view__stamp { position: absolute; right: max(12px, env(safe-area-inset-right, 0px)); bottom: calc(var(--map-bottom-clearance) + 32px); }
.map-view__credit { position: absolute; right: max(4px, env(safe-area-inset-right, 0px)); left: max(4px, env(safe-area-inset-left, 0px)); width: fit-content; max-width: calc(100% - 8px); margin: 0 0 0 auto; overflow-wrap: anywhere; bottom: var(--map-bottom-clearance); padding: 2px 4px; border-radius: 4px; background: var(--app-bg-surface); font-size: 10px; }
@media (max-height: 600px) {
  .map-view__tools { display: flex; align-items: flex-end; }
  .map-view__tools :deep(.zoom) { display: flex; width: 88px; }
  .map-view__tools :deep(.zoom button) { border: 1px solid var(--app-border-subtle); border-radius: 14px 0 0 14px; }
  .map-view__tools :deep(.zoom button + button) { border-left: 0; border-radius: 0 14px 14px 0; }
}
.map-view__dialog { position: fixed; inset: auto 0 0; width: min(100%, 600px); max-height: 80dvh; padding: 0; border: 0; background: transparent; color: var(--app-text-primary); overflow: auto; }
.map-view__dialog::backdrop { background: rgb(0 0 0 / 0.4); }
.map-view__check { display: flex; align-items: center; gap: 12px; min-height: 48px; border-bottom: 1px solid var(--app-border-subtle); }
.map-view__check input { width: 20px; height: 20px; accent-color: var(--app-action-primary); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
button.sr-only:focus-visible { position: static; width: auto; height: 44px; margin: 0; clip-path: none; }
</style>
