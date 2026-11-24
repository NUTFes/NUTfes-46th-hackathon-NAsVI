<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import { RouterLink, useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import FilterBand from '../components/FilterBand.vue';
import FilterChips from '../components/FilterChips.vue';
import PlaceRow from '../components/PlaceRow.vue';
import { applyFilter } from '../domain/filter';
import { distanceM } from '../domain/geo';
import { usePosition } from '../services/position';
import { getStorage, type StorageRepositories, type TagLink } from '../storage';
import { useLabelsStore, useLandmarksStore, usePlacesStore } from '../stores';
import type { Destination, FilterState, MyTag, Place, PlaceKind } from '../types';
import { useAppTokens } from '../app/tokens';

type EmptyAction = { label: string; onClick?: () => unknown; to?: RouteLocationRaw; disabled?: boolean };
// design-system/components/EmptyState.md の title・body・actions に合わせる。
// 既存の実装がないため担当ファイル内に置き、検索と一覧で共用する。
const EmptyState = defineComponent({
  name: 'EmptyState',
  props: {
    title: { type: String, required: true },
    body: String,
    actions: { type: Array as PropType<EmptyAction[]>, default: () => [] },
  },
  setup: props => () => h('section', { class: 'place-view__empty', 'aria-label': '場所が見つからないとき' }, [
    h('span', { 'aria-hidden': 'true' }, '⌕'),
    h('h2', props.title),
    props.body ? h('p', props.body) : null,
    ...props.actions.map(action => action.to
      ? h(RouterLink, { key: action.label, to: action.to }, () => action.label)
      : h('button', { key: action.label, type: 'button', disabled: action.disabled, onClick: action.onClick }, action.label)),
  ]),
});

// SearchView と一覧でデータ・絞り込み・表示用 props の組み立てを共用する。
const props = withDefaults(defineProps<{ searchMode?: boolean; excludeFacilities?: boolean }>(), { searchMode: false, excludeFacilities: false });
const route = useRoute();
const router = useRouter();
const places = usePlacesStore();
const labels = useLabelsStore();
const landmarks = useLandmarksStore();
const { position } = usePosition(); // 許可の要求や位置・方位の送信は行わない。
const keyword = ref('');
const appliedKeyword = ref('');
const searchInput = ref<HTMLInputElement>();
const filter = ref<FilterState>({ labelIds: [], tagIds: [] });
const tags = ref<MyTag[]>([]);
const tagLinks = ref<TagLink[]>([]);
const destination = ref<Destination | null>(null);
const ready = ref(false);
const busy = ref(false);
const error = ref('');
let storage: StorageRepositories | undefined;
// 入力の待ち時間と上限。文字数は API と同じ Unicode コードポイント数。
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_LENGTH = 50;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let composing = false;
let queryWrite: { value: string | undefined } | undefined;

// design-system/claude-design/tokens.css。色・余白・文字はここで固定する。
const root = ref<HTMLElement>();
const appTokens = useAppTokens(root);
const TOKENS = computed(() => ({
  ...appTokens.value,
  '--view-page': 'var(--app-bg-page)', // color.{dark,light}.bg-page
  '--view-surface': 'var(--app-bg-surface)', // color.{dark,light}.bg-surface
  '--view-text': 'var(--app-text-primary)', // color.{dark,light}.text-primary
  '--view-muted': 'var(--app-text-secondary)', // color.{dark,light}.text-secondary
  '--view-border': 'var(--app-border-control)', // claude-design color.tokens.border-control
  '--view-action': 'var(--app-action-primary)', // color.{dark,light}.action-primary
  '--view-danger': 'var(--app-danger-text)', // color.{dark,light}.danger-text
  '--view-danger-bg': 'var(--app-danger-bg)', // color.{dark,light}.danger-bg
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
}));

function limitKeyword(value: string) {
  return [...value].slice(0, SEARCH_MAX_LENGTH).join('');
}
function cancelSearch() {
  clearTimeout(searchTimer);
  searchTimer = undefined;
}
async function replaceQuery(value: string) {
  const q = value || undefined;
  if (route.query.q === q) return;
  const write = { value: q };
  queryWrite = write;
  try {
    // 端末内の経路だけを変更する。他のクエリとハッシュは保ち、履歴は増やさない。
    await router.replace({ query: { ...route.query, q }, hash: route.hash });
  } catch {
    error.value = '検索語を URL に反映できませんでした。もう一度お試しください。';
  } finally {
    if (queryWrite === write) queryWrite = undefined;
  }
}
function applyKeyword() {
  appliedKeyword.value = keyword.value;
  void replaceQuery(keyword.value);
}
function onInput(event: Event) {
  const input = event.target as HTMLInputElement;
  keyword.value = input.value;
  if (composing || (event as InputEvent).isComposing) return;
  keyword.value = limitKeyword(input.value);
  input.value = keyword.value;
  cancelSearch();
  searchTimer = setTimeout(() => {
    searchTimer = undefined;
    applyKeyword();
  }, SEARCH_DEBOUNCE_MS);
}
function startComposition() {
  composing = true;
  cancelSearch();
}
function endComposition(event: CompositionEvent) {
  composing = false;
  onInput(event);
}
watch(() => route.query.q, value => {
  // 自分の replace が完了する前に次の入力が始まっても、その入力を戻さない。
  if (queryWrite && value === queryWrite.value) return;
  cancelSearch();
  composing = false;
  keyword.value = limitKeyword(typeof value === 'string' ? value : '');
  appliedKeyword.value = keyword.value;
  if (typeof value === 'string' && value !== keyword.value) void replaceQuery(keyword.value);
}, { immediate: true });
onBeforeUnmount(cancelSearch);

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
const word = computed(() => appliedKeyword.value.trim());
const normalizedWord = computed(() => word.value.normalize('NFKC').toLowerCase());
// App の一覧は D-030 に従い、絞り込みと件数の計算前に設備を除外する。
const visiblePlaces = computed(() => props.excludeFacilities
  ? places.items.filter(place => place.kind === 'event' || place.kind === 'parking')
  : places.items);
const results = computed(() => {
  if (!ready.value) return [];
  // 設備は検索に出さない(D-027)。一覧の対象は呼び出し側が指定する。
  const candidates = props.searchMode || word.value
    ? visiblePlaces.value.filter(place => (place.kind === 'event' || place.kind === 'parking')
      && place.name.normalize('NFKC').toLowerCase().includes(normalizedWord.value))
    : visiblePlaces.value;
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
})).sort((a, b) => {
  // 現在地があるときは未丸めの距離順。同距離・距離なしは日本語の名前順。
  if (Number.isFinite(a.distanceM) && Number.isFinite(b.distanceM)) {
    const difference = a.distanceM! - b.distanceM!;
    if (difference) return difference;
  }
  return a.place.name.localeCompare(b.place.name, 'ja');
}));
const emptyTitle = computed(() => word.value
  ? `『${word.value}』に一致する企画・場所はありません`
  : props.searchMode ? '企画・場所の名前を入力してください'
    : activeLabels.value.length ? 'この種類の場所はありません' : '場所はまだありません');
const emptyBody = computed(() => activeLabels.value.length
  ? '条件を変えると、見つかることがあります。'
  : word.value ? props.searchMode ? '別の言葉を入力するか、一覧から探してください。' : '別の言葉を入力して探してください。'
    : props.searchMode ? '名前の一部を入力して探せます。' : '場所が登録されると、ここに表示されます。');
const emptyActions = computed<EmptyAction[]>(() => [
  ...(activeLabels.value.length ? [{ label: '絞り込みを解除して探す', onClick: clearFilter, disabled: busy.value }] : []),
  ...(word.value ? [{ label: '別の言葉で探す', onClick: clearKeyword }] : []),
  ...(props.searchMode ? [{ label: '一覧から探す', to: { name: 'list' } }] : []),
]);
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
  cancelSearch();
  composing = false;
  keyword.value = '';
  applyKeyword();
  searchInput.value?.focus();
}
</script>

<template>
  <main ref="root" class="place-view" :style="TOKENS" :aria-busy="(!ready && !error) || busy">
    <h1>{{ searchMode ? '検索結果' : '一覧' }}</h1>
    <div class="place-view__search" role="search">
      <label class="place-view__search-label">
        <span>企画・場所を検索</span>
        <input
          ref="searchInput" :value="keyword" type="search" placeholder="企画・場所を検索" autocomplete="off"
          @input="onInput" @compositionstart="startComposition" @compositionend="endComposition"
        >
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
      <EmptyState v-else :title="emptyTitle" :body="emptyBody" :actions="emptyActions" />
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
.place-view h1, .place-view__empty :deep(h2) { margin: 0 0 var(--view-padding); font-size: var(--view-heading-size); line-height: var(--view-heading-line); font-weight: var(--view-heading-weight); }
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
.place-view__empty :deep(h2), .place-view__empty :deep(p) { margin: 0; overflow-wrap: anywhere; }
.place-view__empty :deep(p) { color: var(--view-muted); }
.place-view button, .place-view__empty :deep(button), .place-view__empty :deep(a) {
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
.place-view button:focus-visible, .place-view__empty :deep(button:focus-visible), .place-view__empty :deep(a:focus-visible) { outline: 2px solid var(--view-action); outline-offset: 2px; }
.place-view__error { padding: var(--view-padding); background: var(--view-danger-bg); color: var(--view-danger); border-radius: var(--view-radius); }
</style>
