<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { adminGet, adminSend, ApiError } from '../../admin/client';
import { useAdminFeedback } from '../../admin/feedback';
import { adminTokens } from '../../admin/tokens';
import { toXY } from '../../domain/geo';
import { useLandmarksStore } from '../../stores/landmarks';
import type { Landmark, Place } from '../../types';

// 色・余白・文字の値とトークン名の対応は admin/tokens.ts の定数を使う。
const landmarkTokens = {
  ...adminTokens,
  '--landmark-heading-size': adminTokens['--admin-banner-title-size'], // font.size.xl
} as const;
const store = useLandmarksStore();
const { reportError, clearError } = useAdminFeedback();
const loaded = ref(false);
// 建物別 API は設備を除くため、削除判定の件数は全場所から数える。
const places = ref<Place[]>([]);
const placesLoaded = ref(false);
const placesError = ref(false);
const placeCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const place of places.value) {
    if (place.landmarkId !== null) counts.set(place.landmarkId, (counts.get(place.landmarkId) ?? 0) + 1);
  }
  return counts;
});
const deleteConflict = ref(false);
const conflictTitle = ref<HTMLElement | null>(null);
const relatedPlaces = computed(() => places.value.filter((place) => place.landmarkId === selectedId.value));
const busy = ref(false);
const notice = ref('');
const selectedId = ref<string | null>(null);
const selected = computed(() => store.items.find((item) => item.id === selectedId.value) ?? null);
// API の輪郭を北が上の確認用図形にする。頂点を操作する入力は設けない。
const shape = computed(() => {
  const footprint = selected.value?.footprint;
  if (!footprint) return null;
  const points = footprint.map(({ lat, lng }) => {
    const [x, y] = toXY(lat, lng);
    return [x, -y];
  });
  const minX = Math.min(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const width = Math.max(1, Math.max(...points.map(([x]) => x)) - minX);
  const height = Math.max(1, Math.max(...points.map(([, y]) => y)) - minY);
  const padding = Math.max(width, height) / 10;
  return {
    viewBox: `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`,
    d: `M ${points.map((point) => point.join(' ')).join(' L ')} Z`,
  };
});
const draft = reactive({ name: '', lat: '' as string | number, lng: '' as string | number });
type FormField = 'name' | 'lat' | 'lng' | 'location';
const fieldErrors = ref<Partial<Record<FormField, string>>>({});
const formElement = ref<HTMLFormElement | null>(null);

function clearFieldError(field: 'name' | 'lat' | 'lng') {
  delete fieldErrors.value[field];
  if (field !== 'name') delete fieldErrors.value.location;
}

function focusInvalidField() {
  void nextTick(() => formElement.value?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
}

function reportSaveError(error: unknown) {
  if (error instanceof ApiError && error.status === 400) {
    const fields: Record<string, FormField> = { name: 'name', location: 'location', 'location.lat': 'lat', 'location.lng': 'lng' };
    const field = fields[error.field ?? ''];
    if (field) {
      fieldErrors.value[field] = error.message;
      focusInvalidField();
      return;
    }
  }
  reportError(error);
}
const confirmingDelete = ref(false);
const locked = computed(() => busy.value || confirmingDelete.value);
const cancelButton = ref<HTMLButtonElement | null>(null);
const deleteButton = ref<HTMLButtonElement | null>(null);
let controller: AbortController | null = null;

// 一度に一つだけ送信し、管理画面を離れた後の応答・エラーは反映しない。
async function perform<T>(request: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void,
  onError: (error: unknown, signal: AbortSignal) => void | Promise<void> = reportError) {
  if (busy.value) return;
  const current = new AbortController();
  controller = current;
  busy.value = true;
  notice.value = '';
  clearError();
  try {
    const result = await request(current.signal);
    if (!current.signal.aborted) apply(result);
  } catch (error) {
    if (!current.signal.aborted) await onError(error, current.signal);
  } finally {
    if (controller === current) {
      busy.value = false;
      controller = null;
    }
  }
}

function resetForm() {
  deleteConflict.value = false;
  fieldErrors.value = {};
  selectedId.value = null;
  Object.assign(draft, { name: '', lat: '', lng: '' });
  confirmingDelete.value = false;
}

function load() {
  if (confirmingDelete.value) return;
  return perform(async (signal) => Promise.allSettled([
    adminGet('/landmarks', { signal }), adminGet('/places', { signal }),
  ]), ([landmarksResult, placesResult]) => {
    if (landmarksResult.status === 'fulfilled') {
      store.setAll(landmarksResult.value.items);
      loaded.value = true;
      if (selectedId.value !== null && !selected.value) resetForm();
    } else reportError(landmarksResult.reason);
    placesLoaded.value = placesResult.status === 'fulfilled';
    placesError.value = placesResult.status === 'rejected';
    if (placesResult.status === 'fulfilled') places.value = placesResult.value.items;
  });
}

function edit(item: Landmark) {
  if (locked.value) return;
  clearError();
  fieldErrors.value = {};
  notice.value = '';
  deleteConflict.value = false;
  selectedId.value = item.id;
  Object.assign(draft, { name: item.name, lat: String(item.location.lat), lng: String(item.location.lng) });
}

function startNew() {
  if (locked.value) return;
  clearError();
  notice.value = '';
  resetForm();
}

function save() {
  if (locked.value || !loaded.value) return;
  clearError();
  notice.value = '';
  fieldErrors.value = {};
  // OpenAPI の文字数は Unicode コードポイント。座標の空欄を 0 にしない。
  if ([...draft.name].length < 1 || [...draft.name].length > 50) {
    fieldErrors.value.name = '名前は1〜50文字で入力してください';
  }
  const lat = Number(draft.lat);
  const lng = Number(draft.lng);
  if (!String(draft.lat).trim() || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    fieldErrors.value.lat = '緯度は−90〜90で入力してください';
  }
  if (!String(draft.lng).trim() || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    fieldErrors.value.lng = '経度は−180〜180で入力してください';
  }
  if (Object.keys(fieldErrors.value).length) {
    focusInvalidField();
    return;
  }
  const id = selectedId.value;
  const body = { name: draft.name, location: { lat, lng } };
  return perform((signal) => id === null
    ? adminSend('POST', '/landmarks', { body, signal })
    : adminSend('PATCH', '/landmarks/{landmarkId}', { params: { landmarkId: id }, body, signal }), (item) => {
    store.setAll(id === null ? [...store.items, item] : store.items.map((entry) => entry.id === id ? item : entry));
    selectedId.value = item.id;
    Object.assign(draft, { name: item.name, lat: String(item.location.lat), lng: String(item.location.lng) });
    notice.value = id === null ? '建物を登録しました。' : '建物を更新しました。';
  }, reportSaveError);
}

function reloadFootprint() {
  const item = selected.value;
  if (locked.value || !item) return;
  return perform((signal) => adminSend('POST', '/landmarks/{landmarkId}/footprint', {
    params: { landmarkId: item.id }, signal,
  }), (updated) => {
    store.setAll(store.items.map((entry) => entry.id === item.id ? updated : entry));
    notice.value = '建物の形を読み込み直しました。';
  });
}

async function askDelete() {
  if (locked.value || !selected.value) return;
  confirmingDelete.value = true;
  await nextTick();
  cancelButton.value?.focus();
}

async function cancelDelete() {
  if (busy.value) return;
  confirmingDelete.value = false;
  await nextTick();
  deleteButton.value?.focus();
}

async function reportDeleteError(error: unknown, signal: AbortSignal) {
  reportError(error);
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== 'landmark_in_use') return;
  confirmingDelete.value = false;
  deleteConflict.value = true;
  placesLoaded.value = false;
  placesError.value = false;
  await nextTick();
  if (signal.aborted) return;
  conflictTitle.value?.focus();
  // 一覧の取得後に場所が付くこともある。設備を含む最新の全場所で案内する。
  try {
    const result = await adminGet('/places', { signal });
    if (signal.aborted) return;
    places.value = result.items;
    placesLoaded.value = true;
  } catch {
    if (!signal.aborted) placesError.value = true;
  }
}

function remove() {
  const item = selected.value;
  if (!confirmingDelete.value || !item) return;
  return perform((signal) => adminSend('DELETE', '/landmarks/{landmarkId}', {
    params: { landmarkId: item.id }, signal,
  }), () => {
    store.setAll(store.items.filter((entry) => entry.id !== item.id));
    resetForm();
    notice.value = '建物を削除しました。';
  }, reportDeleteError);
}

onMounted(load);
onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <main class="landmarks-admin" :style="landmarkTokens" :aria-busy="busy">
    <h2>建物の登録・管理</h2>
    <p v-if="busy" role="status">読み込み・処理中です。</p>
    <p v-if="notice" role="status">{{ notice }}</p>

    <section aria-labelledby="landmarks-list-title">
      <div class="actions">
        <h3 id="landmarks-list-title">建物の一覧</h3>
        <button type="button" :disabled="locked" @click="load">一覧を読み込み直す</button>
        <button type="button" :disabled="locked || !loaded" @click="startNew">新しい建物</button>
      </div>
      <p v-if="placesError" role="status">場所の件数を取得できませんでした。一覧を読み込み直してください。</p>
      <p v-if="loaded && !store.items.length">建物はまだ登録されていません。</p>
      <div v-else-if="loaded" class="table-scroll">
        <table>
          <caption>登録済みの建物と場所の件数・建物の形・見取り図の状態</caption>
          <thead><tr><th scope="col">名前</th><th scope="col">場所の件数</th><th scope="col">建物の形</th><th scope="col">見取り図のある階</th><th scope="col">操作</th></tr></thead>
          <tbody>
            <tr v-for="item in store.items" :key="item.id" :class="{ selected: item.id === selectedId }">
              <th scope="row">{{ item.name }}</th>
              <td>{{ placesLoaded ? `${placeCounts.get(item.id) ?? 0}件` : '未取得' }}</td>
              <td :class="{ missing: item.footprint === null }">{{ item.footprint === null ? '形なし' : '形あり' }}</td>
              <td>{{ item.floors.length ? item.floors.map((plan) => `${plan.floor}階`).join('、') : '未登録' }}</td>
              <td><button type="button" :disabled="locked" :aria-label="`${item.name}を編集`" @click="edit(item)">編集</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="landmark-form-title">
      <h3 id="landmark-form-title">{{ selected ? '建物の更新' : '建物の登録' }}</h3>
      <section v-if="deleteConflict && selected" aria-labelledby="delete-conflict-title">
        <h3 id="delete-conflict-title" ref="conflictTitle" tabindex="-1">「{{ selected.name }}」は場所が付いているため削除できません</h3>
        <p>次の場所を確認し、場所の管理画面で建物を空にするか、別の建物へ付け替えてください。</p>
        <ul v-if="placesLoaded && relatedPlaces.length">
          <li v-for="place in relatedPlaces" :key="place.id">
            <RouterLink :to="{ name: 'card', params: { id: place.id } }">{{ place.name }}</RouterLink>
          </li>
        </ul>
        <p v-else-if="placesLoaded">現在、この建物に付いている場所はありません。もう一度削除を試してください。</p>
        <p v-else>{{ placesError ? '関連する場所を取得できませんでした。一覧を読み込み直してください。' : '関連する場所を読み込んでいます。' }}</p>
        <RouterLink :to="{ name: 'admin-places' }">場所の管理画面を開く</RouterLink>
      </section>
      <form ref="formElement" novalidate @submit.prevent="save">
        <fieldset :disabled="locked || !loaded">
          <legend>名前と位置</legend>
          <label for="landmark-name">名前（1〜50文字）</label>
          <input id="landmark-name" v-model="draft.name" name="name" required
            :aria-invalid="fieldErrors.name ? 'true' : undefined" :aria-describedby="fieldErrors.name ? 'landmark-name-error' : undefined" @input="clearFieldError('name')" />
          <p v-if="fieldErrors.name" id="landmark-name-error" class="field-error" role="alert">{{ fieldErrors.name }}</p>
          <label for="landmark-lat">緯度</label>
          <input id="landmark-lat" v-model="draft.lat" name="lat" type="number" step="any" min="-90" max="90" required
            :aria-invalid="fieldErrors.lat || fieldErrors.location ? 'true' : undefined"
            :aria-describedby="fieldErrors.lat ? 'landmark-lat-error' : fieldErrors.location ? 'landmark-location-error' : undefined" @input="clearFieldError('lat')" />
          <p v-if="fieldErrors.lat" id="landmark-lat-error" class="field-error" role="alert">{{ fieldErrors.lat }}</p>
          <label for="landmark-lng">経度</label>
          <input id="landmark-lng" v-model="draft.lng" name="lng" type="number" step="any" min="-180" max="180" required
            :aria-invalid="fieldErrors.lng || fieldErrors.location ? 'true' : undefined"
            :aria-describedby="fieldErrors.lng ? 'landmark-lng-error' : fieldErrors.location ? 'landmark-location-error' : undefined" @input="clearFieldError('lng')" />
          <p v-if="fieldErrors.lng" id="landmark-lng-error" class="field-error" role="alert">{{ fieldErrors.lng }}</p>
          <p v-if="fieldErrors.location" id="landmark-location-error" class="field-error" role="alert">{{ fieldErrors.location }}</p>
          <button type="submit">{{ selected ? '更新する' : '登録する' }}</button>
        </fieldset>
      </form>
      <section aria-labelledby="landmark-shape-title">
        <h3 id="landmark-shape-title">建物の形（確認用）</h3>
        <p>建物の形は OpenStreetMap から取得します。輪郭は編集できません。</p>
        <template v-if="selected">
          <svg v-if="shape" class="shape-preview" :viewBox="shape.viewBox" role="img" :aria-label="`${selected.name}の建物の形（北が上）`">
            <path :d="shape.d" />
          </svg>
          <p v-else class="missing">形なし（カメラの正面に出ない）</p>
          <p>保存済みの位置で形を取得します。位置を変えたら先に更新してください。</p>
          <button type="button" :disabled="locked" @click="reloadFootprint">形を読み込み直す</button>
        </template>
        <p v-else>建物の登録後に形を確認できます。</p>
        <p class="attribution">© OpenStreetMap contributors（ODbL）</p>
      </section>
      <button v-if="selected" ref="deleteButton" type="button" class="danger" :disabled="locked" @click="askDelete">建物を削除</button>
      <section v-if="confirmingDelete && selected" role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-effects" class="delete-confirm" @keydown.esc.prevent="cancelDelete">
        <h3 id="delete-title">「{{ selected.name }}」を削除しますか？</h3>
        <p id="delete-effects">階ごとの見取り図も消えます。場所が付いている建物は削除できません。先に場所の建物を空にするか、付け替えてください。</p>
        <div class="actions">
          <button ref="cancelButton" type="button" :disabled="busy" @click="cancelDelete">やめる</button>
          <button type="button" class="danger" :disabled="busy" @click="remove">削除する</button>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.landmarks-admin { display: grid; gap: var(--admin-space-xl); color: var(--admin-text); font-family: var(--admin-font); font-size: var(--admin-body-size); font-weight: var(--admin-weight); }
h2, h3, p, ul { margin: 0; }
ul { padding-inline-start: var(--admin-space-xl); }
h2 { font-size: var(--admin-title-size); font-weight: var(--admin-bold); }
h3 { font-size: var(--landmark-heading-size); font-weight: var(--admin-bold); }
section { display: grid; gap: var(--admin-space-lg); min-width: 0; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--admin-space-sm); }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; background: var(--admin-surface); }
caption { text-align: start; padding-bottom: var(--admin-space-sm); color: var(--admin-muted); }
th, td { padding: var(--admin-space-md); border-bottom: thin solid var(--admin-border); text-align: start; overflow-wrap: anywhere; }
th { font-weight: var(--admin-bold); }
.selected { background: var(--admin-selected); }
fieldset { display: grid; gap: var(--admin-space-sm); margin: 0; padding: var(--admin-space-lg); border: thin solid var(--admin-border); border-radius: var(--admin-radius); }
input, button { min-height: var(--admin-touch-target); padding: var(--admin-space-sm) var(--admin-space-lg); border: thin solid var(--admin-border); border-radius: var(--admin-radius); font: inherit; }
input { min-width: 0; box-sizing: border-box; width: 100%; color: var(--admin-text); background: var(--admin-bg); }
button { justify-self: start; color: var(--admin-action); background: var(--admin-surface); font-weight: var(--admin-bold); cursor: pointer; }
button:disabled, fieldset:disabled button { color: var(--admin-muted); cursor: default; }
a { color: var(--admin-action); }
input:focus-visible, button:focus-visible, a:focus-visible, h3[tabindex]:focus { outline: solid var(--admin-action); outline-offset: var(--admin-space-xs); }
.field-error { color: var(--admin-danger-text); }
input[aria-invalid="true"] { border-color: var(--admin-danger); }
.missing { color: var(--admin-danger-text); }
.shape-preview { box-sizing: border-box; width: 100%; aspect-ratio: 2; padding: var(--admin-space-lg); border: thin solid var(--admin-border); border-radius: var(--admin-radius); background: var(--admin-surface); }
.shape-preview path { fill: var(--admin-selected); stroke: var(--admin-action); vector-effect: non-scaling-stroke; }
.attribution { color: var(--admin-muted); }
.danger, .delete-confirm { border: thin solid var(--admin-danger); color: var(--admin-danger-text); background: var(--admin-danger-bg); }
.delete-confirm { padding: var(--admin-space-lg); border-radius: var(--admin-radius); }
</style>
