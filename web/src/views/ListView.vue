<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FilterBand from '../components/FilterBand.vue';
import FilterChips from '../components/FilterChips.vue';
import PlaceRow from '../components/PlaceRow.vue';
import { applyFilter } from '../domain/filter';
import { distanceM } from '../domain/geo';
import { usePosition } from '../services/position';
import { getStorage, type StorageRepositories, type TagLink } from '../storage';
import { useLabelsStore, useLandmarksStore, usePlacesStore } from '../stores';
import type { Destination, FilterState, MyTag, Place, PlaceKind } from '../types';
import '../../../design-system/claude-design/tokens.css';

// SearchView と一覧でデータ・絞り込み・表示用 props の組み立てを共用する。
const props = withDefaults(defineProps<{ searchMode?: boolean }>(), { searchMode: false });
const route = useRoute();
const router = useRouter();
const places = usePlacesStore();
const labels = useLabelsStore();
const landmarks = useLandmarksStore();
const { position } = usePosition(); // 許可の要求や位置・方位の送信は行わない。
const keyword = ref('');
const searchInput = ref<HTMLInputElement>();
const filter = ref<FilterState>({ labelIds: [], tagIds: [] });
const tags = ref<MyTag[]>([]);
const tagLinks = ref<TagLink[]>([]);
const destination = ref<Destination | null>(null);
const ready = ref(false);
const busy = ref(false);
const error = ref('');
let storage: StorageRepositories | undefined;

// design-system/claude-design/tokens.css。色・余白・文字はここで固定する。
const TOKENS = {
  '--view-page': 'var(--bg-page)', // color.{dark,light}.bg-page
  '--view-surface': 'var(--bg-surface)', // color.{dark,light}.bg-surface
  '--view-text': 'var(--text-primary)', // color.{dark,light}.text-primary
  '--view-muted': 'var(--text-secondary)', // color.{dark,light}.text-secondary
  '--view-border': 'var(--border-control)', // color.{dark,light}.border-control
  '--view-action': 'var(--action-primary)', // color.{dark,light}.action-primary
  '--view-danger': 'var(--danger-text)', // color.{dark,light}.danger-text
  '--view-danger-bg': 'var(--danger-bg)', // color.{dark,light}.danger-bg
  '--view-gap': 'var(--space-2)', // space.2
  '--view-padding': 'var(--space-4)', // space.4
  '--view-radius': 'var(--radius-xl)', // radius.xl
  '--view-target': 'var(--touch-target)', // size.touch-target
  '--view-font': 'var(--font-base)', // font.family.base
  '--view-size': '13px', // typography.body / font.size.sm
  '--view-line': '1.5', // typography.body
  '--view-weight': '400', // font.weight.regular
  '--view-heading-size': '20px', // typography.title / font.size.2xl
  '--view-heading-line': '1.35', // typography.title
  '--view-heading-weight': '800', // typography.title / font.weight.extra-bold
  '--view-input-size': '16px', // typography.input / font.size.xl
  '--view-input-line': '1.4', // typography.input
  '--view-input-weight': '500', // typography.input / font.weight.medium
  '--view-action-size': '14px', // typography.action / font.size.md
  '--view-action-weight': '700', // typography.action / font.weight.bold
} as const;

watch(() => route.query.q, value => {
  keyword.value = typeof value === 'string' ? value : '';
}, { immediate: true });

onMounted(async () => {
  try {
    storage = await getStorage();
    const [savedFilter, savedTags, links, savedDestination] = await Promise.all([
      storage.filter.get(), storage.tags.list(), storage.tagLinks.list(), storage.destination.get(),
    ]);
    filter.value = savedFilter;
    tags.value = savedTags;
    tagLinks.value = links;
    destination.value = savedDestination;
    ready.value = true;
  } catch {
    error.value = '端末に保存した情報を読み込めませんでした。画面を開き直してください。';
  }
});

const activeLabels = computed(() => [
  ...filter.value.labelIds.map(id => labels.items.find(label => label.id === id)?.title ?? '削除された種類'),
  ...filter.value.tagIds.map(id => tags.value.find(tag => tag.id === id)?.title ?? '削除されたタグ'),
]);
const word = computed(() => keyword.value.trim());
const results = computed(() => {
  if (!ready.value) return [];
  // 設備は検索に出さない(D-027)。一覧では既存の applyFilter の規則を使う。
  const candidates = props.searchMode || word.value
    ? places.items.filter(place => (place.kind === 'event' || place.kind === 'parking')
      && place.name.toLowerCase().includes(word.value.toLowerCase()))
    : places.items;
  if (props.searchMode && !word.value) return [];
  return applyFilter(candidates, filter.value, tagLinks.value);
});
const kindNames: Record<PlaceKind, string> = {
  event: '企画', parking: '駐車場', info: '案内所', wc: 'トイレ', rest: '休憩所', trash: 'ゴミ箱',
};
const rows = computed(() => results.value.map(place => ({
  place,
  // API の ID・整数を表示用の文字列に変えるのは画面の責務(props-api-check.md)。
  kindLabel: place.labelIds.map(id => labels.items.find(label => label.id === id)?.title)
    .filter(Boolean).join('・') || kindNames[place.kind],
  building: place.landmarkId === null ? '屋外'
    : landmarks.items.find(building => building.id === place.landmarkId)?.name ?? '建物情報なし',
  floor: place.floor === null ? undefined : `${place.floor}階`,
  distanceM: position.value ? distanceM(position.value, place.location) : undefined,
  tags: {
    wantToGo: tagLinks.value.some(link => link.placeId === place.id && link.tagId === 'want-to-go'),
    favorite: tagLinks.value.some(link => link.placeId === place.id && link.tagId === 'favorite'),
  },
})));
const emptyTitle = computed(() => word.value
  ? `『${word.value}』に一致する企画・場所はありません`
  : props.searchMode ? '企画・場所の名前を入力してください'
    : activeLabels.value.length ? 'この種類の場所はありません' : '場所はまだありません');
const emptyHint = computed(() => {
  const hasTag = (tagId: string) => tagLinks.value.some(link => link.tagId === tagId
    && places.items.some(place => place.id === link.placeId));
  if (filter.value.tagIds.includes('favorite') && !hasTag('favorite')) {
    return 'お気に入りはまだありません。場所のカードの星で付けられます。';
  }
  if (filter.value.tagIds.includes('want-to-go') && !hasTag('want-to-go')) {
    return '行きたい場所はまだありません。場所のカードのしおりで付けられます。';
  }
  return '条件に合う場所がありません。絞り込みを解除して探せます。';
});

async function saveFilter(value: FilterState) {
  if (!ready.value || busy.value || !storage) return;
  busy.value = true;
  error.value = '';
  try {
    if (!value.labelIds.length && !value.tagIds.length) await storage.filter.clear();
    else await storage.filter.save(value);
    filter.value = value;
  } catch {
    error.value = '絞り込みを保存できませんでした。もう一度お試しください。';
  } finally {
    busy.value = false;
  }
}
function clearFilter() { return saveFilter({ labelIds: [], tagIds: [] }); }

async function toggleTag(place: Place, tag: 'wantToGo' | 'favorite', on: boolean) {
  if (!ready.value || busy.value || !storage || !places.items.some(item => item.id === place.id)) return;
  const tagId = tag === 'wantToGo' ? 'want-to-go' : 'favorite';
  busy.value = true;
  error.value = '';
  try {
    if (on) await storage.tagLinks.save({ placeId: place.id, tagId });
    else await storage.tagLinks.delete(place.id, tagId);
    tagLinks.value = tagLinks.value.filter(link => link.placeId !== place.id || link.tagId !== tagId);
    if (on) tagLinks.value.push({ placeId: place.id, tagId });
  } catch {
    error.value = 'タグを保存できませんでした。もう一度お試しください。';
  } finally {
    busy.value = false;
  }
}
function openPlace(placeId: string) { void router.push({ name: 'card', params: { id: placeId } }); }
function clearKeyword() {
  keyword.value = '';
  searchInput.value?.focus();
}
</script>

<template>
  <main class="place-view" :style="TOKENS" :aria-busy="(!ready && !error) || busy">
    <h1>{{ searchMode ? '検索結果' : '一覧' }}</h1>
    <div class="place-view__search" role="search">
      <label class="place-view__search-label">
        <span>企画・場所を検索</span>
        <input ref="searchInput" v-model="keyword" type="search" placeholder="企画・場所を検索" autocomplete="off">
      </label>
      <button v-if="keyword" type="button" @click="clearKeyword">検索語を消す</button>
    </div>
    <fieldset class="place-view__filters" :disabled="!ready || busy">
      <legend>場所の絞り込み</legend>
      <FilterChips :labels="labels.items" :tags="tags" :model-value="filter" @update:model-value="saveFilter" />
      <FilterBand
        :labels="activeLabels"
        :count="searchMode || word ? undefined : results.length"
        :empty-hint="emptyHint"
        @clear="clearFilter"
      />
    </fieldset>
    <p v-if="error" class="place-view__error" role="alert">{{ error }}</p>
    <p v-if="!ready && !error" role="status">読み込み中です</p>
    <template v-if="ready">
      <p class="place-view__count" role="status">{{ word ? `『${word}』の検索結果・` : '' }}{{ results.length }} 件</p>
      <ul v-if="rows.length" class="place-view__rows" aria-label="場所の一覧">
        <li v-for="row in rows" :key="row.place.id">
          <PlaceRow
            :place-id="row.place.id"
            :name="row.place.name"
            :kind-label="row.kindLabel"
            :building="row.building"
            :floor="row.floor"
            :distance-m="row.distanceM"
            :highlight="word"
            :tags="searchMode ? undefined : row.tags"
            :is-destination="destination?.placeId === row.place.id"
            :on-open="() => openPlace(row.place.id)"
            :on-toggle-tag="busy ? undefined : (tag, on) => toggleTag(row.place, tag, on)"
          />
        </li>
      </ul>
      <section v-else class="place-view__empty" aria-label="場所が見つからないとき">
        <h2>{{ emptyTitle }}</h2>
        <p v-if="activeLabels.length">条件を変えると、見つかることがあります。</p>
        <button v-if="activeLabels.length" type="button" :disabled="busy" @click="clearFilter">絞り込みを解除して探す</button>
        <button v-if="word" type="button" @click="clearKeyword">別の言葉で探す</button>
        <RouterLink v-if="searchMode" :to="{ name: 'list' }">一覧から探す</RouterLink>
      </section>
    </template>
  </main>
</template>

<style scoped>
.place-view {
  box-sizing: border-box;
  min-height: 100%;
  padding: var(--view-padding);
  background: var(--view-page);
  color: var(--view-text);
  font-family: var(--view-font);
  font-size: var(--view-size);
  line-height: var(--view-line);
  font-weight: var(--view-weight);
}
.place-view h1, .place-view h2 { margin: 0 0 var(--view-padding); font-size: var(--view-heading-size); line-height: var(--view-heading-line); font-weight: var(--view-heading-weight); }
.place-view__search { display: flex; align-items: end; gap: var(--view-gap); }
.place-view__search-label { display: grid; gap: var(--view-gap); flex: 1; min-width: 0; }
.place-view input {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  min-height: calc(var(--view-target) + var(--view-gap) / 2);
  padding: var(--view-gap) var(--view-padding);
  border: 1px solid var(--view-border);
  border-radius: var(--view-radius);
  background: var(--view-surface);
  color: var(--view-text);
  font: inherit;
  font-size: var(--view-input-size);
  line-height: var(--view-input-line);
  font-weight: var(--view-input-weight);
}
.place-view input::placeholder { color: var(--view-muted); opacity: 1; }
.place-view input:focus-visible { outline: 2px solid var(--view-action); outline-offset: 2px; }
.place-view__filters { min-width: 0; padding: 0; margin: var(--view-gap) 0; border: 0; }
.place-view__filters legend { padding: 0; color: var(--view-muted); }
.place-view__count { margin-block: var(--view-padding); }
.place-view__rows { padding: 0; margin: 0; list-style: none; }
.place-view__empty { display: grid; gap: var(--view-gap); padding: var(--view-padding); border-radius: var(--view-radius); background: var(--view-surface); }
.place-view__empty h2, .place-view__empty p { margin: 0; overflow-wrap: anywhere; }
.place-view__empty p { color: var(--view-muted); }
.place-view button, .place-view__empty a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--view-target);
  padding: 0 var(--view-gap);
  border: 1px solid var(--view-border);
  border-radius: var(--view-radius);
  background: var(--view-surface);
  color: var(--view-action);
  font: inherit;
  font-size: var(--view-action-size);
  font-weight: var(--view-action-weight);
  text-decoration: none;
  cursor: pointer;
}
.place-view button:focus-visible, .place-view__empty a:focus-visible { outline: 2px solid var(--view-action); outline-offset: 2px; }
.place-view__error { padding: var(--view-padding); background: var(--view-danger-bg); color: var(--view-danger); border-radius: var(--view-radius); }
</style>
