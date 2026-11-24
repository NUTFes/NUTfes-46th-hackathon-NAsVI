<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { adminGet, adminSend, ApiError } from '../../admin/client';
import { useAdminFeedback } from '../../admin/feedback';
import { adminTokens } from '../../admin/tokens';
import DataTable, { type DataTableColumn } from '../../components/admin/DataTable.vue';
import DeleteConfirm from '../../components/admin/DeleteConfirm.vue';
import FormField from '../../components/admin/FormField.vue';
import Button from '../../components/ui/Button.vue';
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
const busy = ref(false);
const notice = ref('');
const selectedId = ref<string | null>(null);
const relatedPlaces = computed(() => places.value.filter((place) => place.landmarkId === selectedId.value));
const selected = computed(() => store.items.find((item) => item.id === selectedId.value) ?? null);
function hasFootprint(item: Landmark) {
  return item.footprint !== null && item.footprint.length >= 3;
}

// API の輪郭を北が上の確認用図形にする。頂点を操作する入力は設けない。
const shape = computed(() => {
  const footprint = selected.value?.footprint;
  if (!footprint || footprint.length < 3) return null;
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
const deleteDialog = ref<HTMLDialogElement | null>(null);
const deleteConfirm = ref<InstanceType<typeof DeleteConfirm> | null>(null);
const columns: DataTableColumn[] = [
  { key: 'name', label: '名前' }, { key: 'count', label: '場所の件数' }, { key: 'shape', label: '建物の形' },
  { key: 'floors', label: '見取り図のある階' }, { key: 'actions', label: '操作', align: 'end' },
];
const deleteButton = ref<{ $el: HTMLButtonElement } | null>(null);
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

async function edit(item: Landmark) {
  if (locked.value) return;
  clearError();
  fieldErrors.value = {};
  notice.value = '';
  deleteConflict.value = false;
  selectedId.value = item.id;
  Object.assign(draft, { name: item.name, lat: String(item.location.lat), lng: String(item.location.lng) });
  // 押した「編集」ボタンは「編集中」の文字に替わるので、フォーカスをフォーム先頭の入力へ移す。
  await nextTick();
  formElement.value?.querySelector<HTMLInputElement>('#landmark-name')?.focus();
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
    if (id === null && !hasFootprint(item)) {
      notice.value += '輪郭は取得できませんでした。輪郭なしでも一覧・見取り図・建物の企画に使えます。必要なときに形を読み込み直せます。';
    }
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
  clearError();
  deleteConflict.value = false;
  confirmingDelete.value = true;
  await nextTick();
  deleteDialog.value?.showModal();
  deleteConfirm.value?.focusCancel();
}

async function cancelDelete() {
  if (busy.value) return;
  confirmingDelete.value = false;
  await nextTick();
  deleteButton.value?.$el.focus();
}

function handleDeleteKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    void cancelDelete();
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = deleteDialog.value;
  if (!dialog) return;
  const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const first = buttons[0];
  const last = buttons.at(-1);
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
  } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
    event.preventDefault();
    first.focus();
  }
}

async function reportDeleteError(error: unknown, signal: AbortSignal) {
  reportError(error);
  confirmingDelete.value = false;
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== 'landmark_in_use') return;
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
  const result = perform((signal) => adminSend('DELETE', '/landmarks/{landmarkId}', {
    params: { landmarkId: item.id }, signal,
  }), () => {
    store.setAll(store.items.filter((entry) => entry.id !== item.id));
    resetForm();
    notice.value = '建物を削除しました。';
  }, reportDeleteError);
  void result.then(async () => {
    if (confirmingDelete.value || deleteConflict.value) return;
    await nextTick();
    if (selected.value) deleteButton.value?.$el.focus();
    else formElement.value?.querySelector<HTMLInputElement>('#landmark-name')?.focus();
  });
  return result;
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
        <Button variant="secondary" label="一覧を読み込み直す" :disabled="locked" @press="load" />
        <Button variant="secondary" label="新しい建物" :disabled="locked || !loaded" @press="startNew" />
      </div>
      <p v-if="placesError" role="status">場所の件数を取得できませんでした。一覧を読み込み直してください。</p>
      <DataTable
        v-if="loaded" :columns="columns" :rows="store.items" :selected-id="selectedId ?? undefined"
        caption="登録済みの建物と場所の件数・建物の形・見取り図の状態"
      >
        <template #cell-name="{ row }">{{ row.name }}</template>
        <template #cell-count="{ row }">{{ placesLoaded ? `${placeCounts.get(row.id) ?? 0}件` : '未取得' }}</template>
        <template #cell-shape="{ row }"><span :class="{ missing: !hasFootprint(row) }">{{ hasFootprint(row) ? '形あり' : '形なし' }}</span></template>
        <template #cell-floors="{ row }">{{ row.floors.length ? row.floors.map((plan) => `${plan.floor}階`).join('、') : '未登録' }}</template>
        <template #cell-actions="{ row }">
          <span v-if="row.id === selectedId" class="missing">編集中</span>
          <Button v-else variant="secondary" size="sm" label="編集" :disabled="locked" :aria-label="`${row.name}を編集`" @press="edit(row)" />
        </template>
      </DataTable>
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
          <FormField label="名前（1〜50文字）" control-id="landmark-name" :error="fieldErrors.name" error-id="landmark-name-error" alert>
            <input id="landmark-name" v-model="draft.name" name="name" required
              :aria-invalid="fieldErrors.name ? 'true' : undefined" :aria-describedby="fieldErrors.name ? 'landmark-name-error' : undefined" @input="clearFieldError('name')" />
          </FormField>
          <FormField label="緯度" control-id="landmark-lat" :error="fieldErrors.lat" error-id="landmark-lat-error" alert>
            <input id="landmark-lat" v-model="draft.lat" name="lat" type="number" step="any" min="-90" max="90" required
              :aria-invalid="fieldErrors.lat || fieldErrors.location ? 'true' : undefined"
              :aria-describedby="fieldErrors.lat ? 'landmark-lat-error' : fieldErrors.location ? 'landmark-location-error' : undefined" @input="clearFieldError('lat')" />
          </FormField>
          <FormField label="経度" control-id="landmark-lng" :error="fieldErrors.lng" error-id="landmark-lng-error" alert>
            <input id="landmark-lng" v-model="draft.lng" name="lng" type="number" step="any" min="-180" max="180" required
              :aria-invalid="fieldErrors.lng || fieldErrors.location ? 'true' : undefined"
              :aria-describedby="fieldErrors.lng ? 'landmark-lng-error' : fieldErrors.location ? 'landmark-location-error' : undefined" @input="clearFieldError('lng')" />
          </FormField>
          <p v-if="fieldErrors.location" id="landmark-location-error" class="field-error" role="alert">{{ fieldErrors.location }}</p>
          <Button type="submit" :label="selected ? '更新する' : '登録する'" />
        </fieldset>
      </form>
      <section aria-labelledby="landmark-shape-title">
        <h3 id="landmark-shape-title">建物の形（確認用）</h3>
        <p>建物の形は OpenStreetMap から取得します。輪郭は編集できません。</p>
        <template v-if="selected">
          <svg v-if="shape" class="shape-preview" :viewBox="shape.viewBox" role="img" :aria-label="`${selected.name}の建物の形（北が上）`">
            <path :d="shape.d" />
          </svg>
          <p v-else class="missing">形なし（カメラの正面に出ない）。輪郭なしでも一覧・見取り図・建物の企画に使えます。必要なときに形を読み込み直せます。</p>
          <p>保存済みの位置で形を取得します。位置を変えたら先に更新してください。</p>
          <Button variant="secondary" label="形を読み込み直す" :disabled="locked" @press="reloadFootprint" />
        </template>
        <p v-else>建物の登録後に形を確認できます。</p>
        <p class="attribution">© OpenStreetMap contributors（ODbL）</p>
      </section>
      <Button v-if="selected" ref="deleteButton" variant="danger" label="建物を削除" :disabled="locked" @press="askDelete" />
      <dialog v-if="confirmingDelete && selected" ref="deleteDialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-effects" tabindex="-1" class="delete-dialog" @keydown="handleDeleteKeydown" @cancel.prevent="cancelDelete">
        <DeleteConfirm
          ref="deleteConfirm" role="none" :title="`「${selected.name}」を削除しますか？`" :busy="busy"
          effects="階ごとの見取り図も消えます。場所が付いている建物は削除できません。先に場所の建物を空にするか、付け替えてください。"
          @confirm="remove" @cancel="cancelDelete"
        >
          <template #status><p v-if="busy" role="status">削除しています。</p></template>
        </DeleteConfirm>
      </dialog>
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
fieldset { display: grid; gap: var(--admin-space-sm); margin: 0; padding: var(--admin-space-lg); border: thin solid var(--admin-border); border-radius: var(--admin-radius); }
a { color: var(--admin-action); }
a:focus-visible, h3[tabindex]:focus { outline: solid var(--admin-action); outline-offset: var(--admin-space-xs); }
.field-error { color: var(--admin-danger-text); font-weight: var(--admin-bold); }
.missing { color: var(--admin-muted); }
.shape-preview { box-sizing: border-box; width: 100%; aspect-ratio: 2; padding: var(--admin-space-lg); border: thin solid var(--admin-border); border-radius: var(--admin-radius); background: var(--admin-surface); }
.shape-preview path { fill: var(--admin-selected); stroke: var(--admin-action); vector-effect: non-scaling-stroke; }
.attribution { color: var(--admin-muted); }
.delete-dialog { box-sizing: border-box; width: min(100%, 32rem); padding: 0; border: 0; background: transparent; color: inherit; font: inherit; }
.delete-dialog[open] { display: block; }
.delete-dialog::backdrop { background: var(--admin-selected); }
</style>
