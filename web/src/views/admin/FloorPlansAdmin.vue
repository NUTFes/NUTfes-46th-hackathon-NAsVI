<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { adminGet, adminSend } from '../../admin/client';
import { useAdminFeedback } from '../../admin/feedback';
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
const busy = computed(() => loading.value || saving.value);

// API と同じ数値表記を受け付け、空欄・Infinity・16進数などは数値として扱わない。
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
function isNumber(value: string) {
  return numberPattern.test(value.trim()) && Number.isFinite(Number(value));
}

const validationErrors = computed(() => {
  const errors: string[] = [];
  if (floorError.value) errors.push(floorError.value);
  const parts = form.viewBox.trim().split(/\s*,\s*|\s+/);
  if (parts.length !== 4 || !parts.every(isNumber)) {
    errors.push('viewBox は4つの数値で入力してください。');
  } else if (Number(parts[2]) <= 0 || Number(parts[3]) <= 0) {
    errors.push('viewBox の幅と高さは正の数で入力してください。');
  }
  if (!form.d.trim()) errors.push('path の d を入力してください。');
  if (boundsFields.some(({ key }) => !isNumber(form[key]))) {
    errors.push('bounds の north・south・east・west はすべて数値で入力してください。');
  } else {
    if (Number(form.north) <= Number(form.south)) errors.push('bounds は north > south にしてください。');
    if (Number(form.east) <= Number(form.west)) errors.push('bounds は east > west にしてください。');
  }
  return errors;
});

function fillForm(plan?: FloorPlan) {
  Object.assign(form, {
    viewBox: plan?.plan.viewBox ?? '', d: plan?.plan.d ?? '',
    north: plan ? String(plan.bounds.north) : '', south: plan ? String(plan.bounds.south) : '',
    east: plan ? String(plan.bounds.east) : '', west: plan ? String(plan.bounds.west) : '',
  });
  message.value = '';
}

watch(selectedId, () => {
  floor.value = String(selected.value?.floors[0]?.floor ?? 1);
  fillForm(existing.value);
});
watch(floor, () => fillForm(existing.value));
watch(form, () => { message.value = ''; }, { flush: 'sync' });

async function loadLandmarks() {
  if (busy.value) return;
  loading.value = true;
  loadFailed.value = false;
  message.value = '';
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
  if (busy.value || !selected.value || validationErrors.value.length) return;
  const landmarkId = selectedId.value;
  saving.value = true;
  message.value = '';
  clearError();
  try {
    const plan = await adminSend('PUT', '/landmarks/{landmarkId}/floors/{floor}/plan', {
      params: { landmarkId, floor: floorNumber.value }, signal: controller.signal,
      body: {
        plan: { viewBox: form.viewBox.trim(), d: form.d.trim() },
        bounds: { north: Number(form.north), south: Number(form.south), east: Number(form.east), west: Number(form.west) },
      },
    });
    if (controller.signal.aborted) return;
    landmarks.setAll(landmarks.items.map((item) => item.id === landmarkId
      ? { ...item, floors: [...item.floors.filter((entry) => entry.floor !== plan.floor), plan].sort((a, b) => a.floor - b.floor) }
      : item));
    fillForm(plan);
    clearError();
    message.value = `${plan.floor} 階の見取り図を保存しました。`;
  } catch (error) {
    if (!controller.signal.aborted) reportError(error);
  } finally {
    saving.value = false;
  }
}

async function deletePlan() {
  if (busy.value || !selected.value || !existing.value || floorError.value) return;
  const landmarkId = selectedId.value;
  const targetFloor = floorNumber.value;
  saving.value = true;
  message.value = '';
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
    if (!controller.signal.aborted) reportError(error);
  } finally {
    saving.value = false;
  }
}

onMounted(loadLandmarks);
onBeforeUnmount(() => controller.abort());
</script>

<template>
  <main class="floorplans-admin" :aria-busy="busy">
    <h1>見取り図の登録・管理(運営)</h1>
    <button type="button" :disabled="busy" @click="loadLandmarks">建物一覧を読み込み直す</button>
    <p v-if="loading" role="status">建物一覧を読み込んでいます。</p>
    <p v-else-if="loadFailed">建物一覧を読み込めませんでした。もう一度読み込んでください。</p>
    <p v-else-if="!landmarks.items.length">建物がありません。建物の管理画面で登録してください。</p>
    <label for="floorplan-building">建物</label>
    <select id="floorplan-building" v-model="selectedId" :disabled="busy">
      <option value="">建物を選んでください</option>
      <option v-for="item in landmarks.items" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select>

    <form v-if="selected" novalidate @submit.prevent="savePlan">
      <fieldset :disabled="busy">
        <legend>{{ selected.name }} の見取り図</legend>
        <label for="floorplan-floor">階</label>
        <input id="floorplan-floor" v-model="floor" type="number" min="-5" max="20" step="1"
          list="floorplan-registered-floors" aria-describedby="floorplan-floor-help" :aria-invalid="!!floorError" />
        <datalist id="floorplan-registered-floors">
          <option v-for="entry in selected.floors" :key="entry.floor" :value="entry.floor">登録済み</option>
        </datalist>
        <p id="floorplan-floor-help">-5〜20 の整数で指定します。地下は負の数です。</p>
        <p>{{ existing ? 'この階の見取り図は登録済みです。保存すると差し替えます。' : 'この階の見取り図は未登録です。' }}</p>
        <label for="floorplan-viewbox">SVG viewBox</label>
        <input id="floorplan-viewbox" v-model="form.viewBox" type="text" placeholder="0 0 400 240"
          aria-describedby="floorplan-validation" />
        <label for="floorplan-d">path の d</label>
        <textarea id="floorplan-d" v-model="form.d" aria-describedby="floorplan-validation" />
        <template v-for="field in boundsFields" :key="field.key">
          <label :for="`floorplan-${field.key}`">{{ field.label }}</label>
          <input :id="`floorplan-${field.key}`" v-model="form[field.key]" type="text" inputmode="decimal"
            aria-describedby="floorplan-validation" />
        </template>
        <div class="actions">
          <button type="submit" :disabled="!!validationErrors.length">{{ existing ? '差し替えて保存' : '登録する' }}</button>
          <button type="button" class="delete" :disabled="!existing || !!floorError" @click="deletePlan">見取り図を削除</button>
        </div>
      </fieldset>
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
input, textarea, select, button {
  box-sizing: border-box;
  min-width: 0;
  min-height: var(--admin-touch-target);
  padding: var(--admin-space-sm) var(--admin-space-md);
  border: thin solid var(--admin-border);
  border-radius: var(--admin-radius);
  background: var(--admin-surface);
  color: var(--admin-text);
  font: inherit;
}
textarea { resize: vertical; }
button { cursor: pointer; color: var(--admin-action); font-weight: var(--admin-bold); }
button:disabled { cursor: default; color: var(--admin-muted); }
.delete { color: var(--admin-danger-text); background: var(--admin-danger-bg); }
.actions { display: flex; flex-wrap: wrap; gap: var(--admin-space-sm); }
#floorplan-floor-help { color: var(--admin-muted); }
#floorplan-validation { color: var(--admin-danger-text); }
ul { margin: 0; padding-inline-start: var(--admin-space-xl); }
svg { display: block; width: 100%; height: auto; max-height: calc(var(--admin-touch-target) * 8); }
path { fill: none; stroke: var(--admin-action); }
:is(input, textarea, select, button):focus-visible { outline: solid var(--admin-action); outline-offset: var(--admin-space-xs); }
</style>
