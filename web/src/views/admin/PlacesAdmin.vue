<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { adminGet, adminSend, ApiError } from '../../admin/client';
import { useAdminFeedback } from '../../admin/feedback';
import { adminTokens } from '../../admin/tokens';
import LocationPicker from '../../components/admin/LocationPicker.vue';
import { getPickerBounds, inputToPoint, isPointInBounds, outlinePath, pointToLocation, type PickerPoint } from '../../components/admin/locationPickerGeometry';
import Button from '../../components/ui/Button.vue';
import Badge from '../../components/ui/Badge.vue';
import DataTable, { type DataTableColumn } from '../../components/admin/DataTable.vue';
import DeleteConfirm from '../../components/admin/DeleteConfirm.vue';
import FormField from '../../components/admin/FormField.vue';
import type { components } from '../../api/generated/schema';
import { usePlacesStore } from '../../stores/places';
import type { Label, Landmark, Place, PlaceKind } from '../../types';

type PlaceInput = components['schemas']['PlaceInput'];
const kinds: Record<PlaceKind, string> = {
  event: '企画', parking: '駐車場', info: '案内所', wc: 'トイレ', rest: '休憩所', trash: 'ゴミ箱',
};
const columns: DataTableColumn[] = [
  { key: 'name', label: '名前' }, { key: 'kind', label: '種別' }, { key: 'labels', label: '種類' },
  { key: 'position', label: '位置 (緯度・経度)' }, { key: 'floor', label: '階' }, { key: 'hours', label: '開催時間 (日本時間)' },
  { key: 'actions', label: '操作', align: 'end' },
];
const places = usePlacesStore();
const { reportError, clearError } = useAdminFeedback();
const busy = ref(false);
const loaded = ref(false);
const message = ref('');
const landmarks = ref<Landmark[]>([]);
const labels = ref<Label[]>([]);
const fieldErrors = ref<Record<string, string>>({});
const editing = ref<Place | null>(null);
const deleting = ref<Place | null>(null);
const deleteDialog = ref<HTMLDialogElement>();
const nameInput = ref<HTMLInputElement>();
const locked = computed(() => busy.value || deleting.value !== null || !loaded.value);
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());

function emptyForm() {
  return {
    name: '', kind: 'event' as PlaceKind, lat: '', lng: '', description: '',
    landmarkId: '', floor: '', hours: [] as { start: string; end: string }[],
  };
}
const form = reactive(emptyForm());

// 入力・表示は常に日本時間。端末のタイムゾーンは参照しない。
const tokyoTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23',
});
function japanTime(iso: string) {
  const parts = Object.fromEntries(tokyoTime.formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`;
}

function displayTime(iso: string) {
  return japanTime(iso).slice(0, 16).replace('T', ' ');
}

function errorAttrs(field: string, helpId?: string) {
  return {
    'aria-invalid': fieldErrors.value[field] ? 'true' as const : undefined,
    'aria-describedby': [helpId, fieldErrors.value[field] ? `place-${field}-error` : ''].filter(Boolean).join(' ') || undefined,
  };
}

function buildingName(id: string) {
  return landmarks.value.find(building => building.id === id)?.name ?? id;
}

function labelTitle(id: string) {
  return labels.value.find(label => label.id === id)?.title ?? `未取得の種類 (${id})`;
}

function changeLandmark(event: Event) {
  const select = event.target as HTMLSelectElement;
  if (!select.value && form.floor !== '') {
    fieldErrors.value = { floor: '建物を外すには、先に階の入力を消してください。' };
    select.value = form.landmarkId;
    return;
  }
  form.landmarkId = select.value;
  fieldErrors.value = {};
}

async function refreshPlaces() {
  const result = await adminGet('/places', { signal: controller.signal });
  if (controller.signal.aborted) return;
  places.setAll(result.items);
}

async function run(action: () => Promise<void>, refreshOnNotFound = false) {
  if (busy.value || controller.signal.aborted) return;
  busy.value = true;
  message.value = '';
  fieldErrors.value = {};
  clearError();
  try {
    await action();
    if (!controller.signal.aborted) clearError();
  } catch (error) {
    if (controller.signal.aborted) return;
    reportError(error);
    if (error instanceof ApiError && error.status === 400 && error.field) {
      fieldErrors.value = { [error.field]: error.message };
    }
    if (refreshOnNotFound && error instanceof ApiError && error.status === 404) {
      try {
        await refreshPlaces();
        if (!controller.signal.aborted) message.value = '対象の場所が見つかりません。一覧を再取得しました。入力内容を確認してください。';
      } catch {
        if (!controller.signal.aborted) message.value = '対象の場所が見つかりません。一覧の再取得にも失敗しました。再読み込みしてください。';
      }
    }
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

function loadPlaces() {
  return run(async () => {
    const [result, buildings, categories] = await Promise.all([
      adminGet('/places', { signal: controller.signal }),
      adminGet('/landmarks', { signal: controller.signal }),
      adminGet('/labels', { signal: controller.signal }),
    ]);
    if (controller.signal.aborted) return;
    places.setAll(result.items);
    landmarks.value = buildings.items;
    labels.value = categories.items;
    loaded.value = true;
  });
}
onMounted(loadPlaces);

function resetForm() {
  editing.value = null;
  fieldErrors.value = {};
  Object.assign(form, emptyForm());
}

async function editPlace(place: Place) {
  editing.value = place;
  fieldErrors.value = {};
  Object.assign(form, {
    name: place.name, kind: place.kind, lat: String(place.location.lat), lng: String(place.location.lng),
    description: place.description, landmarkId: place.landmarkId ?? '', floor: place.floor?.toString() ?? '',
    hours: place.hours.map(period => ({ start: japanTime(period.start), end: japanTime(period.end) })),
  });
  await nextTick();
  nameInput.value?.focus();
}

function invalid(field: string, text: string): never {
  throw new ApiError({ code: 'invalid_input', message: text, field }, 400);
}

function readInput(): PlaceInput {
  if ([...form.name].length < 1 || [...form.name].length > 50) invalid('name', '名前は1〜50文字で入力してください');
  if ([...form.description].length > 500) invalid('description', '説明は500文字以内で入力してください');
  const lat = Number(form.lat);
  const lng = Number(form.lng);
  if (!form.lat.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90) invalid('location', '緯度を正しく入力してください');
  if (!form.lng.trim() || !Number.isFinite(lng) || lng < -180 || lng > 180) invalid('location', '経度を正しく入力してください');
  const landmarkId = form.landmarkId || null;
  const floor = landmarkId && form.floor !== '' ? Number(form.floor) : null;
  if (floor !== null && (!Number.isInteger(floor) || floor < -5 || floor > 20)) invalid('floor', '階は-5〜20の整数で入力してください');
  const hours = form.hours.map(period => {
    // datetime-local が秒を省略した場合も、API には秒付きの日時を送る。
    const start = `${period.start.length === 16 ? `${period.start}:00` : period.start}+09:00`;
    const end = `${period.end.length === 16 ? `${period.end}:00` : period.end}+09:00`;
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate < startDate) {
      invalid('hours', '開催時間の開始と終了を正しく入力してください');
    }
    return { start, end };
  });
  return { name: form.name, kind: form.kind, location: { lat, lng }, description: form.description, landmarkId, floor, hours };
}

function savePlace() {
  return run(async () => {
    const input = readInput();
    let saved: Place;
    const current = editing.value;
    if (current) {
      // kind・labelIds は PlacePatch に含めない。変更した項目だけを送る。
      const patch: components['schemas']['PlacePatch'] = {};
      if (input.name !== current.name) patch.name = input.name;
      if (input.description !== current.description) patch.description = input.description;
      if (input.location.lat !== current.location.lat || input.location.lng !== current.location.lng) patch.location = input.location;
      if (input.landmarkId !== current.landmarkId) patch.landmarkId = input.landmarkId;
      if (input.floor !== current.floor) patch.floor = input.floor;
      const canonicalHours = (hours: Place['hours']) => hours.map(period => ({
        start: new Date(period.start).toISOString(), end: new Date(period.end).toISOString(),
      }));
      if (JSON.stringify(canonicalHours(input.hours ?? [])) !== JSON.stringify(canonicalHours(current.hours))) patch.hours = input.hours;
      if (!Object.keys(patch).length) {
        message.value = '変更はありません。';
        return;
      }
      saved = await adminSend('PATCH', '/places/{placeId}', {
        params: { placeId: current.id }, body: patch, signal: controller.signal,
      });
    } else {
      saved = await adminSend('POST', '/places', { body: input, signal: controller.signal });
    }
    if (controller.signal.aborted) return;
    places.upsert(saved);
    resetForm();
    message.value = current ? '場所を更新しました。' : '場所を登録しました。';
  }, true);
}

async function requestDelete(place: Place) {
  deleting.value = place;
  await nextTick();
  deleteDialog.value?.showModal();
}

function cancelDelete(event?: Event) {
  event?.preventDefault();
  if (busy.value) return;
  deleteDialog.value?.close();
  deleting.value = null;
}

function confirmDelete() {
  const target = deleting.value;
  if (!target) return;
  return run(async () => {
    try {
      await adminSend('DELETE', '/places/{placeId}', { params: { placeId: target.id }, signal: controller.signal });
    } finally {
      // 失敗時も確認を閉じ、AdminLayout のエラーと再試行の操作を見えるようにする。
      if (!controller.signal.aborted) {
        deleteDialog.value?.close();
        deleting.value = null;
      }
    }
    if (controller.signal.aborted) return;
    places.remove(target.id);
    if (editing.value?.id === target.id) resetForm();
    message.value = '場所を削除しました。';
  }, true);
}

// 入力中の座標は範囲に含めず、配置操作で地図が動かないようにする。
const pickerBounds = computed(() => {
  const points = landmarks.value.flatMap(item => [item.location, ...(item.footprint ?? [])]);
  points.push(...places.items.map(item => item.location));
  return getPickerBounds(points);
});
const pickerPoint = computed(() => inputToPoint(String(form.lat), String(form.lng), pickerBounds.value));
const pickerOutOfRange = computed(() => pickerPoint.value !== null && !isPointInBounds(pickerPoint.value));
const pickerValue = computed(() => pickerOutOfRange.value ? null : pickerPoint.value);
const pickerOutlines = computed(() => landmarks.value.map(item => outlinePath(item.footprint ?? [], pickerBounds.value)).filter(Boolean));
function pickLocation(point: PickerPoint) {
  const location = pointToLocation(point, pickerBounds.value);
  form.lat = String(location.lat);
  form.lng = String(location.lng);
}
</script>

<template>
  <main class="places-admin" :style="adminTokens" :aria-busy="busy">
    <h2>場所の登録・管理</h2>
    <p role="status">{{ busy ? '処理中です。' : message }}</p>
    <section aria-labelledby="places-title">
      <div class="actions">
        <h3 id="places-title">場所の一覧</h3>
        <Button variant="secondary" label="一覧を再読み込み" :disabled="busy || deleting !== null" @press="loadPlaces" />
      </div>
      <p v-if="!loaded && !busy">一覧を取得できませんでした。再読み込みしてください。</p>
      <DataTable
        v-if="loaded" :columns="columns" :rows="places.items" :selected-id="editing?.id"
        caption="登録済みの場所" region-label="場所の表" empty-text="まだ登録されていません"
      >
        <template #cell-name="{ row }">
          <div>{{ row.name }}</div>
          <div class="sub">{{ row.landmarkId ? buildingName(row.landmarkId) : '屋外' }}</div>
        </template>
        <template #cell-kind="{ row }">
          <Badge v-if="row.kind === 'parking'" tone="parking" :label="kinds[row.kind]" />
          <template v-else>{{ kinds[row.kind] }}</template>
        </template>
        <template #cell-labels="{ row }">
          <template v-if="row.labelIds.length"><Badge v-for="id in row.labelIds" :key="id" :label="labelTitle(id)" /></template>
          <span v-else class="sub">なし</span>
        </template>
        <template #cell-position="{ row }">
          <span class="sub">緯度 {{ row.location.lat }} / 経度 {{ row.location.lng }}</span>
        </template>
        <template #cell-floor="{ row }">{{ row.floor === null ? '階の指定なし' : `${row.floor}階` }}</template>
        <template #cell-hours="{ row }">
          <div v-for="(period, index) in row.hours" :key="index">{{ displayTime(period.start) }} 〜 {{ displayTime(period.end) }}</div>
          <span v-if="!row.hours.length">指定なし</span>
        </template>
        <template #cell-actions="{ row }">
          <div class="actions actions--end">
            <span v-if="row.id === editing?.id" class="sub">編集中</span>
            <Button v-else variant="secondary" size="sm" label="編集" :disabled="locked" :aria-label="`${row.name}を編集`" @press="editPlace(row)" />
            <Button variant="danger" size="sm" label="削除" :disabled="locked" :aria-label="`${row.name}を削除`" @press="requestDelete(row)" />
          </div>
        </template>
      </DataTable>
    </section>

    <section aria-labelledby="place-form-title">
      <h3 id="place-form-title">{{ editing ? '場所の更新' : '場所の登録' }}</h3>
      <p v-if="editing">同じ場所の同じ項目を複数人が更新すると、あとから送信した内容が残ります。</p>
      <form aria-labelledby="place-form-title" novalidate @submit.prevent="savePlace">
        <fieldset :disabled="locked">
          <legend>場所の情報</legend>
          <FormField label="名前 (必須)" control-id="place-name" :error="fieldErrors.name" error-id="place-name-error">
            <input id="place-name" ref="nameInput" v-model="form.name" v-bind="errorAttrs('name')" required maxlength="50">
          </FormField>
          <FormField
            label="種別 (必須)" control-id="place-kind" help="種別を変える場合は、削除して新しく登録し直してください。" help-id="kind-help"
            :error="fieldErrors.kind" error-id="place-kind-error"
          >
            <select id="place-kind" v-model="form.kind" v-bind="errorAttrs('kind', 'kind-help')" :disabled="editing !== null">
              <option v-for="(title, kind) in kinds" :key="kind" :value="kind">{{ title }}</option>
            </select>
          </FormField>
          <LocationPicker :value="pickerValue" :out-of-range="pickerOutOfRange" :outlines="pickerOutlines" :disabled="locked" @change="pickLocation" />
          <FormField label="緯度 (必須)" control-id="place-lat">
            <input id="place-lat" v-model="form.lat" v-bind="errorAttrs('location')" type="text" inputmode="decimal" required>
          </FormField>
          <FormField label="経度 (必須)" control-id="place-lng" :error="fieldErrors.location" error-id="place-location-error">
            <input id="place-lng" v-model="form.lng" v-bind="errorAttrs('location')" type="text" inputmode="decimal" required>
          </FormField>
          <FormField label="説明" control-id="place-description" :error="fieldErrors.description" error-id="place-description-error">
            <textarea id="place-description" v-model="form.description" v-bind="errorAttrs('description')" maxlength="500" />
          </FormField>
          <FormField label="建物 (屋外は「建物なし」)" control-id="place-landmark" :error="fieldErrors.landmarkId" error-id="place-landmarkId-error">
            <select id="place-landmark" :value="form.landmarkId" v-bind="errorAttrs('landmarkId')" @change="changeLandmark">
              <option value="">建物なし</option>
              <option v-if="form.landmarkId && !landmarks.some(building => building.id === form.landmarkId)" :value="form.landmarkId" disabled>未取得の建物 ({{ form.landmarkId }})</option>
              <option v-for="building in landmarks" :key="building.id" :value="building.id">{{ building.name }}</option>
            </select>
          </FormField>
          <FormField
            label="階 (任意・地下は負の数)" control-id="place-floor" help="建物を外す場合は、先に階を空欄にしてください。" help-id="floor-help"
            :error="fieldErrors.floor" error-id="place-floor-error"
          >
            <input id="place-floor" v-model="form.floor" v-bind="errorAttrs('floor', 'floor-help')" type="text" inputmode="numeric" :disabled="!form.landmarkId">
          </FormField>
          <fieldset v-bind="errorAttrs('hours')">
            <legend>開催時間 (任意・複数可)</legend>
            <p>日本時間 (Asia/Tokyo) で入力してください。開催時間がない場合は空のままにしてください。</p>
            <p v-if="fieldErrors.hours" id="place-hours-error" class="field-error">{{ fieldErrors.hours }}</p>
            <div v-for="(period, index) in form.hours" :key="index" class="period">
              <FormField :label="`開始 ${index + 1}`" :control-id="`period-start-${index}`">
                <input :id="`period-start-${index}`" v-model="period.start" v-bind="errorAttrs('hours')" type="datetime-local" step="any" required>
              </FormField>
              <FormField :label="`終了 ${index + 1}`" :control-id="`period-end-${index}`">
                <input :id="`period-end-${index}`" v-model="period.end" v-bind="errorAttrs('hours')" type="datetime-local" step="any" required>
              </FormField>
              <Button variant="secondary" label="この時間帯を外す" :aria-label="`開催時間${index + 1}を外す`" @press="form.hours.splice(index, 1)" />
            </div>
            <Button variant="secondary" label="時間帯を追加" @press="form.hours.push({ start: '', end: '' })" />
          </fieldset>
          <div class="actions">
            <Button type="submit" :label="editing ? '更新する' : '登録する'" />
            <Button v-if="editing" variant="secondary" label="編集をキャンセル" @press="resetForm" />
          </div>
        </fieldset>
      </form>
    </section>

    <dialog ref="deleteDialog" role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-effects" @cancel="cancelDelete">
      <DeleteConfirm
        v-if="deleting" role="none" :title="`「${deleting.name}」を削除しますか？`" :busy="busy"
        @confirm="confirmDelete" @cancel="cancelDelete()"
      >
        <p>削除すると、次のことが連動して起きます。</p>
        <ul>
          <li>この場所が検索・一覧から消えます。</li>
          <li>この場所に付いていた運営の種類が外れます。</li>
          <li>この場所を行き先にしていた来場者の案内が終わります。</li>
        </ul>
        <p>スタンプは地点に付くため、場所の削除には連動しません。</p>
        <p>削除は取り消せません。削除した ID は再利用されません。</p>
      </DeleteConfirm>
    </dialog>
  </main>
</template>

<style scoped>
.places-admin { display: grid; gap: var(--admin-space-xl); min-width: 0; background: var(--admin-bg); color: var(--admin-text); font-family: var(--admin-font); font-size: var(--admin-body-size); font-weight: var(--admin-weight); }
h2, h3, p { margin: unset; }
h2 { font-size: var(--admin-title-size); font-weight: var(--admin-bold); }
h3 { font-size: var(--admin-banner-title-size); font-weight: var(--admin-bold); }
section, form, fieldset, .period { display: grid; gap: var(--admin-space-md); min-width: 0; }
fieldset { margin: unset; padding: var(--admin-space-lg); border: thin solid var(--admin-border); border-radius: var(--admin-radius); }
legend { font-weight: var(--admin-bold); }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--admin-space-sm); }
.actions--end { justify-content: flex-end; }
.sub { color: var(--admin-muted); font-size: var(--admin-label-size); font-weight: var(--admin-weight); }
.field-error { color: var(--admin-danger-text); font-weight: var(--admin-bold); }
dialog { box-sizing: border-box; width: min(100%, 32rem); padding: 0; border: 0; background: transparent; color: inherit; font: inherit; }
dialog::backdrop { background: var(--admin-selected); }
</style>
