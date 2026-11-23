<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { adminGet, adminSend, ApiError } from '../../admin/client';
import { useAdminFeedback } from '../../admin/feedback';
import { adminTokens } from '../../admin/tokens';
import { useLabelsStore, usePlacesStore } from '../../stores';

// 色・余白・文字は adminTokens の定数を再利用する。
// color.{light,dark}.{bg-page,bg-surface,text-primary,text-secondary,border-subtle,action-primary,danger-text}
// space.{1,2,3,4,6}, radius.sm, size.touch-target,
// font.family.base, font.size.{md,xl}, font.weight.{regular,bold}
const TOKENS = adminTokens;
const TITLE_MAX_LENGTH = 20; // OpenAPI: LabelInput.title.maxLength
const labels = useLabelsStore();
const places = usePlacesStore();
const { reportError, clearError } = useAdminFeedback();
const controller = new AbortController();
const { signal } = controller;
const loading = ref(false);
const saving = ref(false);
const ready = ref(false);
const newTitle = ref('');
const notice = ref('');
const labelInUse = ref(false);
const titleLength = computed(() => [...newTitle.value].length);
const validTitle = computed(() => titleLength.value >= 1 && titleLength.value <= TITLE_MAX_LENGTH);
const disabled = computed(() => loading.value || saving.value || !ready.value);

async function loadLists() {
  if (loading.value || saving.value) return;
  loading.value = true;
  ready.value = false;
  notice.value = '';
  labelInUse.value = false;
  clearError();
  try {
    const [labelResult, placeResult] = await Promise.allSettled([
      adminGet('/labels', { signal }),
      adminGet('/places', { signal }),
    ]);
    if (signal.aborted) return;
    if (labelResult.status === 'rejected') {
      reportError(labelResult.reason);
      return;
    }
    if (placeResult.status === 'rejected') {
      reportError(placeResult.reason);
      return;
    }
    labels.setAll(labelResult.value.items);
    places.setAll(placeResult.value.items);
    ready.value = true;
  } finally {
    loading.value = false;
  }
}

// 更新は自動再送せず、成功応答を得たときだけ共有ストアに反映する。
async function mutate<T>(request: () => Promise<T>, apply: (result: T) => void, message: string) {
  if (disabled.value) return;
  saving.value = true;
  notice.value = '';
  labelInUse.value = false;
  clearError();
  try {
    const result = await request();
    if (signal.aborted) return;
    apply(result);
    notice.value = message;
  } catch (error) {
    if (signal.aborted) return;
    labelInUse.value = error instanceof ApiError && error.status === 409 && error.code === 'label_in_use';
    reportError(error);
  } finally {
    saving.value = false;
  }
}

function createLabel() {
  if (!validTitle.value) return;
  return mutate(
    () => adminSend('POST', '/labels', { body: { title: newTitle.value }, signal }),
    (label) => {
      labels.setAll([...labels.items, label]);
      newTitle.value = '';
    },
    '種類を作成しました。',
  );
}

function removeLabel(labelId: string) {
  return mutate(
    () => adminSend('DELETE', '/labels/{labelId}', { params: { labelId }, signal }),
    () => labels.setAll(labels.items.filter((label) => label.id !== labelId)),
    '種類を削除しました。',
  );
}

function toggleLabel(placeId: string, labelId: string, event: Event) {
  const place = places.items.find((item) => item.id === placeId);
  if (!place) return;
  const assigned = place.labelIds.includes(labelId);
  // ネイティブのチェックも成功までは元の状態を保つ。失敗時に付け外しが済んだように見せない。
  (event.target as HTMLInputElement).checked = assigned;
  return mutate(
    () => adminSend(assigned ? 'DELETE' : 'PUT', '/places/{placeId}/labels/{labelId}', {
      params: { placeId, labelId }, signal,
    }),
    () => {
      const current = places.items.find((item) => item.id === placeId);
      if (!current) return;
      const labelIds = current.labelIds.filter((id) => id !== labelId);
      places.upsert({ ...current, labelIds: assigned ? labelIds : [...labelIds, labelId] });
    },
    assigned ? '場所から種類を外しました。' : '場所に種類を付けました。',
  );
}

onMounted(loadLists);
onBeforeUnmount(() => controller.abort());
</script>

<template>
  <main class="labels-admin" :style="TOKENS" :aria-busy="loading || saving">
    <h2>種類の定義・管理(運営)</h2>
    <button type="button" :disabled="loading || saving" @click="loadLists">一覧を読み込む</button>
    <p v-if="loading" role="status">一覧を読み込んでいます。</p>
    <p v-else-if="!ready">一覧を読み込めませんでした。「一覧を読み込む」で再試行してください。</p>
    <p v-if="saving" role="status">変更を保存しています。</p>
    <p v-if="notice" role="status">{{ notice }}</p>

    <form aria-label="種類の作成" @submit.prevent="createLabel">
      <label for="label-title">新しい種類の名前</label>
      <p id="label-title-help" class="muted">
        1〜{{ TITLE_MAX_LENGTH }}文字で入力してください。同じ名前の種類は作成できません。
      </p>
      <input
        id="label-title" v-model="newTitle" type="text" required
        aria-describedby="label-title-help" :aria-invalid="titleLength > TITLE_MAX_LENGTH"
        :disabled="disabled"
      >
      <button type="submit" :disabled="disabled || !validTitle">種類を作成</button>
    </form>

    <section v-if="ready" aria-labelledby="labels-heading">
      <h3 id="labels-heading">登録済みの種類</h3>
      <p class="muted">場所に付いている種類は削除できません。</p>
      <p v-if="labelInUse" class="conflict" role="status">
        この種類は場所に付いているため削除できません。
        「場所への付け外し」で、付いているすべての場所から外してから削除してください。
      </p>
      <p v-if="labels.items.length === 0">種類はまだ登録されていません。</p>
      <ul v-else class="label-list">
        <li v-for="label in labels.items" :key="label.id">
          <span>{{ label.title }}</span>
          <button
            type="button" :aria-label="`${label.title}を削除`" :disabled="disabled"
            @click="removeLabel(label.id)"
          >削除</button>
        </li>
      </ul>
    </section>

    <section v-if="ready" aria-labelledby="assignments-heading">
      <h3 id="assignments-heading">場所への付け外し</h3>
      <p class="muted">チェックを切り替えると保存します。外しても種類そのものは削除されません。</p>
      <p v-if="places.items.length === 0">場所はまだ登録されていません。</p>
      <p v-else-if="labels.items.length === 0">種類を作成すると、場所に付けられます。</p>
      <div v-else class="place-list">
        <fieldset v-for="place in places.items" :key="place.id" :disabled="disabled">
          <legend>{{ place.name }}</legend>
          <label v-for="label in labels.items" :key="label.id" class="check-row">
            <input
              type="checkbox" :checked="place.labelIds.includes(label.id)"
              :aria-label="`${place.name}の${label.title}`"
              @change="toggleLabel(place.id, label.id, $event)"
            >
            <span>{{ label.title }}</span>
          </label>
        </fieldset>
      </div>
    </section>
  </main>
</template>

<style scoped>
.labels-admin {
  display: grid;
  gap: var(--admin-space-lg);
  color: var(--admin-text);
  font-family: var(--admin-font);
  font-size: var(--admin-body-size);
  font-weight: var(--admin-weight);
  overflow-wrap: anywhere;
}
h2, h3, p { margin: 0; }
h2, h3 { font-size: var(--admin-banner-title-size); font-weight: var(--admin-bold); }
form, section, .place-list { display: grid; gap: var(--admin-space-md); }
form, fieldset {
  min-width: 0;
  margin: 0;
  padding: var(--admin-space-lg);
  border: thin solid var(--admin-border);
  border-radius: var(--admin-radius);
  background: var(--admin-surface);
}
legend { font-weight: var(--admin-bold); }
.muted { color: var(--admin-muted); }
.conflict { color: var(--admin-danger-text); }
.label-list { display: grid; gap: var(--admin-space-sm); margin: 0; padding: 0; list-style: none; }
.label-list li { display: flex; align-items: center; flex-wrap: wrap; gap: var(--admin-space-lg); }
button, input[type='text'] {
  box-sizing: border-box;
  min-width: 0;
  min-height: var(--admin-touch-target);
  padding: var(--admin-space-sm) var(--admin-space-lg);
  border: thin solid var(--admin-border);
  border-radius: var(--admin-radius);
  background: var(--admin-surface);
  color: var(--admin-text);
  font: inherit;
}
button { justify-self: start; font-weight: var(--admin-bold); cursor: pointer; }
button:disabled, fieldset:disabled .check-row { cursor: default; }
.check-row { display: flex; align-items: center; gap: var(--admin-space-sm); min-height: var(--admin-touch-target); cursor: pointer; }
input[type='checkbox'] { accent-color: var(--admin-action); margin: 0; }
button:focus-visible, input:focus-visible { outline: solid var(--admin-action); outline-offset: var(--admin-space-xs); }
</style>
