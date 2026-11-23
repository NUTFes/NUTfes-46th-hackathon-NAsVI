<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { adminGet, adminSend, ApiError } from '../../admin/client';
import { useAdminFeedback } from '../../admin/feedback';
import { adminTokens } from '../../admin/tokens';
import type { components } from '../../api/generated/schema';
import { usePlacesStore } from '../../stores/places';
import type { Place, PlaceKind } from '../../types';

type PlaceInput = components['schemas']['PlaceInput'];
const kinds: Record<PlaceKind, string> = {
  event: '企画', parking: '駐車場', info: '案内所', wc: 'トイレ', rest: '休憩所', trash: 'ゴミ箱',
};
const places = usePlacesStore();
const { reportError, clearError } = useAdminFeedback();
const busy = ref(false);
const loaded = ref(false);
const message = ref('');
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

// datetime-local は操作する端末の時刻。API には UTC の ISO 8601 を送る。
function localTime(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1);
}

async function run(action: () => Promise<void>) {
  if (busy.value || controller.signal.aborted) return;
  busy.value = true;
  message.value = '';
  clearError();
  try {
    await action();
    if (!controller.signal.aborted) clearError();
  } catch (error) {
    if (!controller.signal.aborted) reportError(error);
  } finally {
    if (!controller.signal.aborted) busy.value = false;
  }
}

function loadPlaces() {
  return run(async () => {
    const result = await adminGet('/places', { signal: controller.signal });
    if (controller.signal.aborted) return;
    places.setAll(result.items);
    loaded.value = true;
  });
}
onMounted(loadPlaces);

function resetForm() {
  editing.value = null;
  Object.assign(form, emptyForm());
}

async function editPlace(place: Place) {
  editing.value = place;
  Object.assign(form, {
    name: place.name, kind: place.kind, lat: String(place.location.lat), lng: String(place.location.lng),
    description: place.description, landmarkId: place.landmarkId ?? '', floor: place.floor?.toString() ?? '',
    hours: place.hours.map(period => ({ start: localTime(period.start), end: localTime(period.end) })),
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
    const start = new Date(period.start);
    const end = new Date(period.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
      invalid('hours', '開催時間の開始と終了を正しく入力してください');
    }
    return { start: start.toISOString(), end: end.toISOString() };
  });
  if (new Set(hours.map(period => period.start)).size !== hours.length) invalid('hours', '開催時間の開始が重複しています');
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
      const originalHours = current.hours.map(period => ({
        start: new Date(period.start).toISOString(), end: new Date(period.end).toISOString(),
      }));
      if (JSON.stringify(input.hours) !== JSON.stringify(originalHours)) patch.hours = input.hours;
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
  });
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
  });
}
</script>

<template>
  <main class="places-admin" :style="adminTokens" :aria-busy="busy">
    <h2>場所の登録・管理</h2>
    <p role="status">{{ busy ? '処理中です。' : message }}</p>
    <section aria-labelledby="places-title">
      <div class="actions">
        <h3 id="places-title">場所の一覧</h3>
        <button type="button" :disabled="busy || deleting !== null" @click="loadPlaces">一覧を再読み込み</button>
      </div>
      <p v-if="!loaded && !busy">一覧を取得できませんでした。再読み込みしてください。</p>
      <div v-if="loaded" class="table-scroll" role="region" aria-label="場所の表" tabindex="0">
        <table>
          <caption>登録済みの場所</caption>
          <thead><tr><th scope="col">名前</th><th scope="col">種別</th><th scope="col">種類 (ID)</th><th scope="col">位置の状態</th><th scope="col">操作</th></tr></thead>
          <tbody>
            <tr v-for="place in places.items" :key="place.id">
              <th scope="row">{{ place.name }}</th>
              <td>{{ kinds[place.kind] }}</td>
              <td>{{ place.labelIds.join('、') || 'なし' }}</td>
              <td>
                <div>緯度 {{ place.location.lat }} / 経度 {{ place.location.lng }}</div>
                <div>{{ place.landmarkId ? `建物 ${place.landmarkId} / ${place.floor === null ? '階の指定なし' : `${place.floor}階`}` : '屋外' }}</div>
              </td>
              <td><div class="actions">
                <button type="button" :disabled="locked" :aria-label="`${place.name}を編集`" @click="editPlace(place)">編集</button>
                <button type="button" class="danger" :disabled="locked" :aria-label="`${place.name}を削除`" @click="requestDelete(place)">削除</button>
              </div></td>
            </tr>
            <tr v-if="!places.items.length"><td colspan="5">場所はまだ登録されていません。</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="place-form-title">
      <h3 id="place-form-title">{{ editing ? '場所の更新' : '場所の登録' }}</h3>
      <form aria-labelledby="place-form-title" @submit.prevent="savePlace">
        <fieldset :disabled="locked">
          <legend>場所の情報</legend>
          <label for="place-name">名前 (必須)</label>
          <input id="place-name" ref="nameInput" v-model="form.name" required maxlength="50">
          <label for="place-kind">種別 (必須)</label>
          <select id="place-kind" v-model="form.kind" :disabled="editing !== null" aria-describedby="kind-help">
            <option v-for="(title, kind) in kinds" :key="kind" :value="kind">{{ title }}</option>
          </select>
          <p id="kind-help">種別を変える場合は、削除して新しく登録し直してください。</p>
          <label for="place-lat">緯度 (必須)</label>
          <input id="place-lat" v-model="form.lat" type="text" inputmode="decimal" required>
          <label for="place-lng">経度 (必須)</label>
          <input id="place-lng" v-model="form.lng" type="text" inputmode="decimal" required>
          <label for="place-description">説明</label>
          <textarea id="place-description" v-model="form.description" maxlength="500" />
          <label for="place-landmark">建物 ID (屋外は空欄)</label>
          <input id="place-landmark" v-model="form.landmarkId" @input="form.floor = ''">
          <label for="place-floor">階 (任意・地下は負の数)</label>
          <input id="place-floor" v-model="form.floor" type="text" inputmode="numeric" :disabled="!form.landmarkId">
          <fieldset>
            <legend>開催時間 (任意・複数可)</legend>
            <p>この端末の現地時刻で入力してください。</p>
            <div v-for="(period, index) in form.hours" :key="index" class="period">
              <label :for="`period-start-${index}`">開始 {{ index + 1 }}</label>
              <input :id="`period-start-${index}`" v-model="period.start" type="datetime-local" step="any" required>
              <label :for="`period-end-${index}`">終了 {{ index + 1 }}</label>
              <input :id="`period-end-${index}`" v-model="period.end" type="datetime-local" step="any" required>
              <button type="button" :aria-label="`開催時間${index + 1}を外す`" @click="form.hours.splice(index, 1)">この時間帯を外す</button>
            </div>
            <button type="button" @click="form.hours.push({ start: '', end: '' })">時間帯を追加</button>
          </fieldset>
          <div class="actions">
            <button type="submit">{{ editing ? '更新する' : '登録する' }}</button>
            <button v-if="editing" type="button" @click="resetForm">編集をキャンセル</button>
          </div>
        </fieldset>
      </form>
    </section>

    <dialog ref="deleteDialog" aria-labelledby="delete-title" aria-describedby="delete-effects" @cancel="cancelDelete">
      <template v-if="deleting">
        <h3 id="delete-title">「{{ deleting.name }}」を削除しますか？</h3>
        <div id="delete-effects">
          <p>削除すると、次のことが連動して起きます。</p>
          <ul>
            <li>この場所が検索・一覧から消えます。</li>
            <li>この場所に付いていた運営の種類が外れます。</li>
            <li>この場所を行き先にしていた来場者の案内が終わります。</li>
          </ul>
          <p>スタンプは地点に付くため、場所の削除には連動しません。</p>
          <p>削除は取り消せません。削除した ID は再利用されません。</p>
        </div>
        <div class="actions">
          <button type="button" autofocus :disabled="busy" @click="cancelDelete()">キャンセル</button>
          <button type="button" class="danger" :disabled="busy" @click="confirmDelete">了承して削除する</button>
        </div>
      </template>
    </dialog>
  </main>
</template>

<style scoped>
/* 使用トークンは adminTokens と同じ参照元で固定する。
 * --admin-bg: color.{light,dark}.bg-page; --admin-surface: color.{light,dark}.bg-surface
 * --admin-text: color.{light,dark}.text-primary; --admin-action: color.{light,dark}.action-primary
 * --admin-border: color.{light,dark}.border-subtle; --admin-danger: color.{light,dark}.danger
 * --admin-danger-bg: color.{light,dark}.danger-bg; --admin-danger-text: color.{light,dark}.danger-text
 * --admin-space-xs: space.1; --admin-space-sm: space.2; --admin-space-md: space.3
 * --admin-space-lg: space.4; --admin-space-xl: space.6; --admin-radius: radius.sm
 * --admin-touch-target: size.touch-target; --admin-font: font.family.base
 * --admin-body-size: font.size.md; --admin-title-size: font.size.3xl
 * --admin-banner-title-size: font.size.xl; --admin-weight: font.weight.regular; --admin-bold: font.weight.bold
 */
.places-admin { display: grid; gap: var(--admin-space-xl); min-width: 0; background: var(--admin-bg); color: var(--admin-text); font-family: var(--admin-font); font-size: var(--admin-body-size); font-weight: var(--admin-weight); }
h2, h3, p { margin: unset; }
h2 { font-size: var(--admin-title-size); font-weight: var(--admin-bold); }
h3 { font-size: var(--admin-banner-title-size); font-weight: var(--admin-bold); }
section, form, fieldset, .period { display: grid; gap: var(--admin-space-md); min-width: 0; }
fieldset { margin: unset; padding: var(--admin-space-lg); border: thin solid var(--admin-border); border-radius: var(--admin-radius); }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--admin-space-sm); }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; background: var(--admin-surface); }
caption { padding: var(--admin-space-sm); text-align: start; }
th, td { padding: var(--admin-space-md); text-align: start; border-bottom: thin solid var(--admin-border); overflow-wrap: anywhere; }
th, legend { font-weight: var(--admin-bold); }
input, select, textarea, button { box-sizing: border-box; min-height: var(--admin-touch-target); min-width: var(--admin-touch-target); padding: var(--admin-space-sm) var(--admin-space-md); border: thin solid var(--admin-border); border-radius: var(--admin-radius); background: var(--admin-surface); color: var(--admin-text); font: inherit; }
input, select, textarea { width: 100%; }
button { cursor: pointer; font-weight: var(--admin-bold); }
button:disabled { cursor: default; }
.danger { border-color: var(--admin-danger); background: var(--admin-danger-bg); color: var(--admin-danger-text); }
:is(button, input, select, textarea, .table-scroll):focus-visible { outline: solid var(--admin-action); outline-offset: var(--admin-space-xs); }
dialog { padding: var(--admin-space-xl); border: thin solid var(--admin-border); border-radius: var(--admin-radius); background: var(--admin-surface); color: var(--admin-text); font: inherit; }
dialog h3, dialog p, dialog ul { margin-block: var(--admin-space-md); }
dialog ul { padding-inline-start: var(--admin-space-xl); }
</style>
