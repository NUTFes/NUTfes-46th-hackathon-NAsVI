<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { adminGet, adminSend, ApiError } from '../../admin/client';
import { useAdminFeedback } from '../../admin/feedback';
import { adminTokens } from '../../admin/tokens';
import { toXY } from '../../domain/geo';
import { useLandmarksStore } from '../../stores/landmarks';
import type { Landmark } from '../../types';

// 色・余白・文字の値とトークン名の対応は admin/tokens.ts の定数を使う。
const landmarkTokens = {
  ...adminTokens,
  '--landmark-heading-size': adminTokens['--admin-banner-title-size'], // font.size.xl
} as const;
const store = useLandmarksStore();
const { reportError, clearError } = useAdminFeedback();
const loaded = ref(false);
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
const confirmingDelete = ref(false);
const locked = computed(() => busy.value || confirmingDelete.value);
const cancelButton = ref<HTMLButtonElement | null>(null);
const deleteButton = ref<HTMLButtonElement | null>(null);
let controller: AbortController | null = null;

// 一度に一つだけ送信し、管理画面を離れた後の応答・エラーは反映しない。
async function perform<T>(request: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void) {
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
    if (!current.signal.aborted) reportError(error);
  } finally {
    if (controller === current) {
      busy.value = false;
      controller = null;
    }
  }
}

function resetForm() {
  selectedId.value = null;
  Object.assign(draft, { name: '', lat: '', lng: '' });
  confirmingDelete.value = false;
}

function load() {
  if (confirmingDelete.value) return;
  return perform((signal) => adminGet('/landmarks', { signal }), (result) => {
    store.setAll(result.items);
    loaded.value = true;
    if (selectedId.value !== null && !selected.value) resetForm();
  });
}

function edit(item: Landmark) {
  if (locked.value) return;
  clearError();
  notice.value = '';
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
  // OpenAPI の文字数は Unicode コードポイント。座標の空欄を 0 にしない。
  if ([...draft.name].length < 1 || [...draft.name].length > 50) {
    reportError(new ApiError({ code: 'invalid_input', message: '名前は1〜50文字で入力してください', field: 'name' }, 400));
    return;
  }
  const lat = Number(draft.lat);
  const lng = Number(draft.lng);
  if (!String(draft.lat).trim() || !String(draft.lng).trim() || !Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    reportError(new ApiError({ code: 'invalid_input', message: '緯度は−90〜90、経度は−180〜180で入力してください', field: 'location' }, 400));
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
  });
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

function remove() {
  const item = selected.value;
  if (!confirmingDelete.value || !item) return;
  return perform((signal) => adminSend('DELETE', '/landmarks/{landmarkId}', {
    params: { landmarkId: item.id }, signal,
  }), () => {
    store.setAll(store.items.filter((entry) => entry.id !== item.id));
    resetForm();
    notice.value = '建物を削除しました。';
  });
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
      <p v-if="loaded && !store.items.length">建物はまだ登録されていません。</p>
      <div v-else-if="loaded" class="table-scroll">
        <table>
          <caption>登録済みの建物と建物の形・見取り図の状態</caption>
          <thead><tr><th scope="col">名前</th><th scope="col">建物の形</th><th scope="col">見取り図のある階</th><th scope="col">操作</th></tr></thead>
          <tbody>
            <tr v-for="item in store.items" :key="item.id" :class="{ selected: item.id === selectedId }">
              <th scope="row">{{ item.name }}</th>
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
      <form @submit.prevent="save">
        <fieldset :disabled="locked || !loaded">
          <legend>名前と位置</legend>
          <label for="landmark-name">名前（1〜50文字）</label>
          <input id="landmark-name" v-model="draft.name" name="name" required />
          <label for="landmark-lat">緯度</label>
          <input id="landmark-lat" v-model="draft.lat" name="lat" type="number" step="any" min="-90" max="90" required />
          <label for="landmark-lng">経度</label>
          <input id="landmark-lng" v-model="draft.lng" name="lng" type="number" step="any" min="-180" max="180" required />
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
h2, h3, p { margin: 0; }
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
input:focus-visible, button:focus-visible { outline: solid var(--admin-action); outline-offset: var(--admin-space-xs); }
.missing { color: var(--admin-danger-text); }
.shape-preview { box-sizing: border-box; width: 100%; aspect-ratio: 2; padding: var(--admin-space-lg); border: thin solid var(--admin-border); border-radius: var(--admin-radius); background: var(--admin-surface); }
.shape-preview path { fill: var(--admin-selected); stroke: var(--admin-action); vector-effect: non-scaling-stroke; }
.attribution { color: var(--admin-muted); }
.danger, .delete-confirm { border: thin solid var(--admin-danger); color: var(--admin-danger-text); background: var(--admin-danger-bg); }
.delete-confirm { padding: var(--admin-space-lg); border-radius: var(--admin-radius); }
</style>
