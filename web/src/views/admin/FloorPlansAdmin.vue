<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { adminGet, adminSend, ApiError } from '../../admin/client';
import { useAdminFeedback } from '../../admin/feedback';
import DataTable, { type DataTableColumn } from '../../components/admin/DataTable.vue';
import DeleteConfirm from '../../components/admin/DeleteConfirm.vue';
import FieldBox from '../../components/admin/FormField.vue';
import Button from '../../components/ui/Button.vue';
import { useLandmarksStore } from '../../stores/landmarks';
import type { FloorPlan } from '../../types';

const landmarks = useLandmarksStore();
const { reportError, clearError } = useAdminFeedback();
const selectedId = ref('');
const floor = ref<string | number>('1');
const loading = ref(false);
const saving = ref(false);
const loadFailed = ref(false);
const message = ref('');
const serverError = ref<ApiError | null>(null);
const confirmingDelete = ref(false);
const deleteConfirm = ref<InstanceType<typeof DeleteConfirm> | null>(null);
const deleteTrigger = ref<{ $el: HTMLButtonElement } | null>(null);
const floorColumns: DataTableColumn[] = [
  { key: 'floor', label: '階' }, { key: 'state', label: '見取り図の状態' }, { key: 'actions', label: '操作', align: 'end' },
];
const controller = new AbortController();
const form = reactive({ viewBox: '', d: '', north: '', south: '', east: '', west: '' });
const boundsFields = [
  { key: 'north', label: '北 (north)' }, { key: 'south', label: '南 (south)' },
  { key: 'east', label: '東 (east)' }, { key: 'west', label: '西 (west)' },
] as const;
const selected = computed(() => landmarks.items.find((item) => item.id === selectedId.value));
const floorNumber = computed(() => Number(floor.value));
const floorError = computed(() => String(floor.value).trim() === '' || !Number.isInteger(floorNumber.value)
  || floorNumber.value < -5 || floorNumber.value > 20 ? '階は -5〜20 の整数で指定してください。' : '');
const existing = computed(() => floorError.value ? undefined
  : selected.value?.floors.find((item) => item.floor === floorNumber.value));
const floorRows = computed(() => (selected.value?.floors ?? []).map((entry) => ({ id: String(entry.floor), floor: entry.floor })));
const busy = computed(() => loading.value || saving.value);
type FormField = 'floor' | keyof typeof form;
const payloadFields = ['viewBox', 'd', 'north', 'south', 'east', 'west'] as const;
const payloadTooLargeMessage = '見取り図は 1 MB 以下にしてください。';
// サイズの検証と送信で同じ本文を使う。JSON のエスケープと UTF-8 のバイト数も含める。
const requestBody = computed(() => ({
  plan: { viewBox: form.viewBox.trim(), d: form.d.trim() },
  bounds: { north: Number(form.north), south: Number(form.south), east: Number(form.east), west: Number(form.west) },
}));
const bodyTooLarge = computed(() => new TextEncoder().encode(JSON.stringify(requestBody.value)).byteLength > 1024 * 1024);

// API と同じ数値表記を受け付け、空欄・Infinity・16進数などは数値として扱わない。
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
function isNumber(value: string) {
  return numberPattern.test(value.trim()) && Number.isFinite(Number(value));
}

const localFieldErrors = computed(() => {
  const errors: Record<FormField, string[]> = { floor: [], viewBox: [], d: [], north: [], south: [], east: [], west: [] };
  if (floorError.value) errors.floor.push(floorError.value);
  // カンマと空白を別々に分割し、長い空白でも正規表現の後戻りを避ける。
  const parts = form.viewBox.trim().split(',').flatMap((part) => part.trim().split(/\s+/));
  if (parts.length !== 4 || !parts.every(isNumber)) {
    errors.viewBox.push('viewBox は4つの数値で入力してください。');
  } else if (Number(parts[2]) <= 0 || Number(parts[3]) <= 0) {
    errors.viewBox.push('viewBox の幅と高さは正の数で入力してください。');
  }
  if (!form.d.trim()) errors.d.push('path の d を入力してください。');
  if (form.d.length > 200000) errors.d.push('path の d は 200000 文字以下にしてください。');
  for (const { key, label } of boundsFields) {
    if (!isNumber(form[key])) {
      errors[key].push('bounds の north・south・east・west はすべて数値で入力してください。');
    } else {
      const limit = key === 'north' || key === 'south' ? 90 : 180;
      if (Math.abs(Number(form[key])) > limit) errors[key].push(`${label} は -${limit}〜${limit} で入力してください。`);
    }
  }
  if (isNumber(form.north) && isNumber(form.south) && Number(form.north) <= Number(form.south)) {
    for (const key of ['north', 'south'] as const) errors[key].push('bounds は north > south にしてください。');
  }
  if (isNumber(form.east) && isNumber(form.west) && Number(form.east) <= Number(form.west)) {
    for (const key of ['east', 'west'] as const) errors[key].push('bounds は east > west にしてください。');
  }
  return errors;
});
const validationErrors = computed(() => [...new Set([
  ...Object.values(localFieldErrors.value).flat(), ...(bodyTooLarge.value ? [payloadTooLargeMessage] : []),
])]);
const payloadError = computed(() => bodyTooLarge.value || serverError.value?.status === 413
  || serverError.value?.code === 'payload_too_large' ? payloadTooLargeMessage : '');
const serverFields = computed<readonly FormField[]>(() => {
  if (serverError.value?.status !== 400) return [];
  const field = serverError.value.field;
  // 現行 API は親の plan / bounds を返す。子項目の field も対応する入力に結ぶ。
  if (field === 'body') return payloadFields;
  if (field === 'plan') return ['viewBox', 'd'];
  if (field === 'bounds') return ['north', 'south', 'east', 'west'];
  if (field === 'floor') return ['floor'];
  if (field === 'plan.viewBox') return ['viewBox'];
  if (field === 'plan.d') return ['d'];
  return boundsFields.filter(({ key }) => field === `bounds.${key}`).map(({ key }) => key);
});
function fieldError(field: FormField) {
  return [...localFieldErrors.value[field], ...(serverFields.value.includes(field) && serverError.value
    ? [serverError.value.message] : [])].join(' ');
}
function fieldDescription(field: FormField) {
  return [`floorplan-${field}-help`, ...(fieldError(field) ? [`floorplan-${field}-error`] : [])].join(' ');
}
function reportFormError(error: unknown) {
  serverError.value = error instanceof ApiError ? error : null;
  reportError(error);
}

function fillForm(plan?: FloorPlan) {
  Object.assign(form, {
    viewBox: plan?.plan.viewBox ?? '', d: plan?.plan.d ?? '',
    north: plan ? String(plan.bounds.north) : '', south: plan ? String(plan.bounds.south) : '',
    east: plan ? String(plan.bounds.east) : '', west: plan ? String(plan.bounds.west) : '',
  });
  message.value = '';
  serverError.value = null;
  confirmingDelete.value = false;
}

watch(selectedId, () => {
  floor.value = String(selected.value?.floors[0]?.floor ?? 1);
  fillForm(existing.value);
});
watch(floor, () => fillForm(existing.value));
watch(form, () => { message.value = ''; serverError.value = null; }, { flush: 'sync' });

async function loadLandmarks() {
  if (busy.value || confirmingDelete.value) return;
  loading.value = true;
  loadFailed.value = false;
  message.value = '';
  serverError.value = null;
  clearError();
  try {
    const result = await adminGet('/landmarks', { signal: controller.signal });
    if (controller.signal.aborted) return;
    landmarks.setAll(result.items);
    if (!selected.value) selectedId.value = '';
    fillForm(existing.value);
    clearError();
  } catch (error) {
    if (!controller.signal.aborted) {
      loadFailed.value = true;
      reportError(error);
    }
  } finally {
    loading.value = false;
  }
}

async function savePlan() {
  if (busy.value || confirmingDelete.value || !selected.value || validationErrors.value.length) return;
  const landmarkId = selectedId.value;
  saving.value = true;
  message.value = '';
  serverError.value = null;
  clearError();
  try {
    const plan = await adminSend('PUT', '/landmarks/{landmarkId}/floors/{floor}/plan', {
      params: { landmarkId, floor: floorNumber.value }, signal: controller.signal,
      body: requestBody.value,
    });
    if (controller.signal.aborted) return;
    landmarks.setAll(landmarks.items.map((item) => item.id === landmarkId
      ? { ...item, floors: [...item.floors.filter((entry) => entry.floor !== plan.floor), plan].sort((a, b) => a.floor - b.floor) }
      : item));
    fillForm(plan);
    clearError();
    message.value = `${plan.floor} 階の見取り図を保存しました。`;
  } catch (error) {
    if (!controller.signal.aborted) reportFormError(error);
  } finally {
    saving.value = false;
  }
}

async function requestDelete() {
  if (busy.value || !selected.value || !existing.value || floorError.value) return;
  confirmingDelete.value = true;
  await nextTick();
  deleteConfirm.value?.focusCancel();
}

async function cancelDelete() {
  if (busy.value) return;
  confirmingDelete.value = false;
  await nextTick();
  deleteTrigger.value?.$el.focus();
}

async function deletePlan() {
  if (busy.value || !confirmingDelete.value || !selected.value || !existing.value || floorError.value) return;
  const landmarkId = selectedId.value;
  const targetFloor = floorNumber.value;
  saving.value = true;
  message.value = '';
  serverError.value = null;
  clearError();
  try {
    await adminSend('DELETE', '/landmarks/{landmarkId}/floors/{floor}/plan', {
      params: { landmarkId, floor: targetFloor }, signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    landmarks.setAll(landmarks.items.map((item) => item.id === landmarkId
      ? { ...item, floors: item.floors.filter((entry) => entry.floor !== targetFloor) } : item));
    fillForm();
    clearError();
    message.value = `${targetFloor} 階の見取り図を削除しました。`;
  } catch (error) {
    if (!controller.signal.aborted) reportFormError(error);
  } finally {
    saving.value = false;
    confirmingDelete.value = false;
  }
}

onMounted(loadLandmarks);
onBeforeUnmount(() => controller.abort());
</script>

<template>
  <main class="floorplans-admin" :aria-busy="busy">
    <h1>見取り図の登録・管理(運営)</h1>
    <Button variant="secondary" label="建物一覧を読み込み直す" :disabled="busy || confirmingDelete" @press="loadLandmarks" />
    <p v-if="loading" role="status">建物一覧を読み込んでいます。</p>
    <p v-else-if="loadFailed">建物一覧を読み込めませんでした。もう一度読み込んでください。</p>
    <p v-else-if="!landmarks.items.length">建物がありません。建物の管理画面で登録してください。</p>
    <FieldBox label="建物" control-id="floorplan-building">
      <select id="floorplan-building" v-model="selectedId" :disabled="busy || confirmingDelete">
        <option value="">建物を選んでください</option>
        <option v-for="item in landmarks.items" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </FieldBox>

    <DataTable
      v-if="selected" :columns="floorColumns" :rows="floorRows" :selected-id="existing ? String(floorNumber) : undefined"
      :caption="`${selected.name} の登録済みの階`" empty-text="まだ登録されていません。下のフォームから登録してください。"
    >
      <template #cell-floor="{ row }">{{ row.floor }} 階</template>
      <template #cell-state="{ row }">{{ row.floor === floorNumber ? '登録済み・編集中' : '登録済み' }}</template>
      <template #cell-actions="{ row }">
        <Button variant="secondary" size="sm" label="編集" :disabled="busy || confirmingDelete" :aria-label="`${row.floor} 階を編集`" @press="floor = String(row.floor)" />
      </template>
    </DataTable>

    <form v-if="selected" novalidate @submit.prevent="savePlan">
      <fieldset :disabled="busy || confirmingDelete">
        <legend>{{ selected.name }} の見取り図</legend>
        <FieldBox
          label="階" control-id="floorplan-floor" help="-5〜20 の整数で指定します。地下は負の数です。" help-id="floorplan-floor-help"
          :error="fieldError('floor')" error-id="floorplan-floor-error"
        >
          <input id="floorplan-floor" v-model="floor" type="number" min="-5" max="20" step="1"
            list="floorplan-registered-floors" :aria-describedby="fieldDescription('floor')" :aria-invalid="!!fieldError('floor')" />
          <datalist id="floorplan-registered-floors">
            <option v-for="entry in selected.floors" :key="entry.floor" :value="entry.floor">登録済み</option>
          </datalist>
        </FieldBox>
        <p>{{ existing ? 'この階の見取り図は登録済みです。保存すると差し替えます。' : 'この階の見取り図は未登録です。' }}</p>
        <FieldBox
          label="SVG viewBox" control-id="floorplan-viewbox" help="左端・上端・幅・高さの4つの数値です。幅と高さは正の数にしてください。" help-id="floorplan-viewBox-help"
          :error="fieldError('viewBox')" error-id="floorplan-viewBox-error"
        >
          <input id="floorplan-viewbox" v-model="form.viewBox" type="text" placeholder="0 0 400 240"
            :aria-describedby="fieldDescription('viewBox')" :aria-invalid="!!fieldError('viewBox')" />
        </FieldBox>
        <FieldBox
          label="path の d" control-id="floorplan-d" help="SVG の path データを 200000 文字以下で入力してください。本文全体は 1 MB 以下です。" help-id="floorplan-d-help"
          :error="fieldError('d')" error-id="floorplan-d-error"
        >
          <textarea id="floorplan-d" v-model="form.d" :aria-describedby="fieldDescription('d')" :aria-invalid="!!fieldError('d')" />
        </FieldBox>
        <FieldBox
          v-for="field in boundsFields" :key="field.key" :label="field.label" :control-id="`floorplan-${field.key}`"
          :help="field.key === 'north' || field.key === 'south' ? '緯度は -90〜90 です。north > south にしてください。' : '経度は -180〜180 です。east > west にしてください。'"
          :help-id="`floorplan-${field.key}-help`" :error="fieldError(field.key)" :error-id="`floorplan-${field.key}-error`"
        >
          <input :id="`floorplan-${field.key}`" v-model="form[field.key]" type="text" inputmode="decimal"
            :aria-describedby="fieldDescription(field.key)" :aria-invalid="!!fieldError(field.key)" />
        </FieldBox>
        <p v-if="payloadError" id="floorplan-payload-error" class="field-error" aria-live="polite">{{ payloadError }}</p>
        <div class="actions">
          <Button type="submit" :label="existing ? '差し替えて保存' : '登録する'" :disabled="!!validationErrors.length" />
          <Button ref="deleteTrigger" class="delete" variant="danger" label="見取り図を削除" :disabled="!existing || !!floorError" @press="requestDelete" />
        </div>
      </fieldset>
      <DeleteConfirm
        v-if="confirmingDelete" ref="deleteConfirm" :level="2" title-id="floorplan-delete-title" effects-id="floorplan-delete-effects"
        :title="`${selected.name} の ${floorNumber} 階の見取り図を削除しますか？`" :busy="busy"
        effects="この階の見取り図が来場者の画面から消えます。この操作は元に戻せません。"
        @keydown.esc.prevent.stop="cancelDelete" @confirm="deletePlan" @cancel="cancelDelete"
      />
      <section aria-labelledby="floorplan-preview-title">
        <h2 id="floorplan-preview-title">プレビュー</h2>
        <div id="floorplan-validation" aria-live="polite">
          <ul v-if="validationErrors.length">
            <li v-for="error in validationErrors" :key="error">{{ error }}</li>
          </ul>
        </div>
        <svg v-if="!validationErrors.length" :viewBox="form.viewBox.trim()" role="img" aria-label="見取り図のプレビュー">
          <path :d="form.d.trim()" />
        </svg>
      </section>
    </form>
    <p v-if="message" role="status">{{ message }}</p>
  </main>
</template>

<style scoped>
.floorplans-admin, form, fieldset, section { display: grid; gap: var(--admin-space-md); }
h1, h2, p { margin: 0; }
h1 { font-size: var(--admin-title-size); font-weight: var(--admin-bold); }
h2, legend { font-size: var(--admin-banner-title-size); font-weight: var(--admin-bold); }
fieldset, section {
  min-width: 0;
  padding: var(--admin-space-lg);
  border: thin solid var(--admin-border);
  border-radius: var(--admin-radius);
  background: var(--admin-surface);
}
.actions { display: flex; flex-wrap: wrap; gap: var(--admin-space-sm); }
.field-error { color: var(--admin-danger-text); font-weight: var(--admin-bold); }
#floorplan-validation { color: var(--admin-danger-text); }
ul { margin: 0; padding-inline-start: var(--admin-space-xl); }
svg { display: block; width: 100%; height: auto; max-height: calc(var(--admin-touch-target) * 8); }
path { fill: none; stroke: var(--admin-action); }
</style>
