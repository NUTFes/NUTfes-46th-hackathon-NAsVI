<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import tokensJson from '../../../design-system/tokens.json?raw';
import { useAppTokens } from '../app/tokens';
import Banner from '../components/ui/Banner.vue';
import Button from '../components/ui/Button.vue';
import Icon from '../components/ui/Icon.vue';
import { BUILTIN_TAGS, getStorage, type StorageRepositories } from '../storage';
import { usePlacesStore } from '../stores/places';
import type { MyTag } from '../types';

// 色は I-0 の --app-*（useAppTokens）。寸法だけ design-system/tokens.json から読む。
const tokens: unknown = JSON.parse(tokensJson);
function token<T>(path: string): T {
  const node = path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], tokens);
  return (node as { $value: T }).$value;
}
type Dimension = { value: number; unit: string };
type Color = { components: number[]; alpha?: number };
function dimension(path: string) {
  const value = token<Dimension>(path);
  return `${value.value}${value.unit}`;
}
function rgba(value: Color) {
  return `rgb(${value.components.map(component => component * 255).join(' ')} / ${value.alpha ?? 1})`;
}
const touchTarget = token<Dimension>('size.touch-target').value; // size.touch-target
const shadow = token<{ color: Color; offsetX: Dimension; offsetY: Dimension; blur: Dimension; spread: Dimension }>('shadow.sheet'); // shadow.sheet
const root = ref<HTMLElement>();
const appTokens = useAppTokens(root);
const theme = computed(() => ({
  ...appTokens.value,
  '--space-1': dimension('space.1'), // space.1
  '--space-2': dimension('space.2'), // space.2
  '--space-3': dimension('space.3'), // space.3
  '--space-4': dimension('space.4'), // space.4
  '--space-6': dimension('space.6'), // space.6
  '--radius': dimension('radius.sm'), // radius.sm
  '--sheet-radius': dimension('radius.2xl'), // radius.2xl
  '--touch': dimension('size.touch-target'), // size.touch-target
  // CheckRow.md requires 54px; there is no dedicated row-height token.
  '--row-height': `${touchTarget + token<Dimension>('radius.md').value}px`, // size.touch-target + radius.md
  '--body-size': dimension('font.size.md'), // font.size.md
  '--small-size': dimension('font.size.xs'), // font.size.xs
  '--title-size': dimension('font.size.2xl'), // font.size.2xl
  '--shadow': `${[shadow.offsetX, shadow.offsetY, shadow.blur, shadow.spread].map(v => `${v.value}${v.unit}`).join(' ')} ${rgba(shadow.color)}`, // shadow.sheet
}));

const route = useRoute();
const router = useRouter();
const places = usePlacesStore();
const placeId = computed(() => typeof route.params.id === 'string' ? route.params.id : '');
const place = computed(() => places.items.find(item => item.id === placeId.value));
const tags = ref<MyTag[]>([]);
const selected = ref<string[]>([]);
const orderedTags = computed(() => [
  ...BUILTIN_TAGS.flatMap(builtin => tags.value.filter(tag => tag.id === builtin.id)),
  ...tags.value.filter(tag => !BUILTIN_TAGS.some(builtin => builtin.id === tag.id)),
]);
const title = ref('');
const inputError = ref('');
const error = ref('');
const loading = ref(true);
const ready = ref(false);
const busy = ref(false);
const memoryOnly = ref(false);
const reload = ref(0);
const sheet = ref<HTMLElement>();
let composing = false;
let compositionJustEnded = false;
let compositionEndTimer: ReturnType<typeof setTimeout> | undefined;
function startComposition() {
  clearTimeout(compositionEndTimer);
  compositionJustEnded = false;
  composing = true;
}
function endComposition() {
  composing = false;
  // compositionend が keydown より先に来るブラウザーでも、同じ確定操作を送信しない。
  compositionJustEnded = true;
  clearTimeout(compositionEndTimer);
  compositionEndTimer = setTimeout(() => { compositionJustEnded = false; }, 0);
}
function guardImeEnter(event: KeyboardEvent) {
  if (composing || event.isComposing || event.keyCode === 229 || compositionJustEnded) event.preventDefault();
}
let storage: StorageRepositories | undefined;
let disposed = false;

watch([placeId, reload], async ([id], _previous, onCleanup) => {
  let active = true;
  const unsubscribe: (() => void)[] = [];
  onCleanup(() => { active = false; unsubscribe.forEach(stop => stop()); });
  loading.value = true;
  ready.value = false;
  tags.value = [];
  selected.value = [];
  title.value = '';
  inputError.value = '';
  error.value = '';
  try {
    const local = await getStorage();
    if (!active) return;
    storage = local;
    memoryOnly.value = local.mode === 'memory';
    unsubscribe.push(
      local.onModeChange(mode => { memoryOnly.value = mode === 'memory'; }),
      local.onWriteNotPersisted(() => { memoryOnly.value = true; }),
    );
    const [savedTags, links] = await Promise.all([local.tags.list(), local.tagLinks.list(id)]);
    if (!active) return;
    tags.value = savedTags;
    selected.value = links.map(link => link.tagId);
    ready.value = true;
  } catch {
    if (active) error.value = 'タグを読み込めませんでした。もう一度読み込んでください。';
  } finally {
    if (active) loading.value = false;
  }
}, { immediate: true });

const canEdit = computed(() => ready.value && !!place.value && !loading.value && !busy.value);
async function toggle(tagId: string) {
  if (!canEdit.value || !storage) return;
  const id = placeId.value;
  const local = storage;
  const attached = selected.value.includes(tagId);
  busy.value = true;
  error.value = '';
  try {
    if (attached) await local.tagLinks.delete(id, tagId);
    else await local.tagLinks.save({ placeId: id, tagId });
    if (disposed || id !== placeId.value) return;
    selected.value = attached ? selected.value.filter(value => value !== tagId) : [...selected.value, tagId];
  } catch {
    if (!disposed && id === placeId.value) error.value = 'タグを付け外しできませんでした。もう一度操作してください。';
  } finally {
    busy.value = false;
  }
}

async function createTag() {
  if (composing || compositionJustEnded || !canEdit.value || !storage) return;
  // Provisional (OQ-13): trim, reject blank/exact duplicates; no length/count limit.
  // Renaming/deletion, including BUILTIN_TAGS, are not offered while OQ-13 is undecided.
  const name = title.value.trim();
  inputError.value = !name ? 'タグの名前を入力してください。'
    : tags.value.some(tag => tag.title === name) ? '同じ名前のタグがあります。一覧から選んでください。' : '';
  if (inputError.value) return;
  const id = placeId.value;
  const local = storage;
  busy.value = true;
  error.value = '';
  let saved = false;
  try {
    const tag: MyTag = { id: crypto.randomUUID(), title: name, builtin: false };
    await local.tags.save(tag);
    saved = true;
    if (!disposed && id === placeId.value) {
      tags.value = [...tags.value, tag];
      title.value = '';
    }
    await local.tagLinks.save({ placeId: id, tagId: tag.id });
    if (!disposed && id === placeId.value) selected.value = [...selected.value, tag.id];
  } catch {
    if (!disposed && id === placeId.value) error.value = saved
      ? 'タグは作れましたが、この場所に付けられませんでした。一覧から選んでください。'
      : 'タグを作れませんでした。もう一度操作してください。';
  } finally {
    busy.value = false;
  }
}

function close() {
  void router.push(place.value ? { name: 'card', params: { id: placeId.value } } : { name: 'map' });
}
let swipeStart: { x: number; y: number } | undefined;
function startSwipe(event: TouchEvent) {
  const touch = event.touches[0];
  swipeStart = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
}
function endSwipe(event: TouchEvent) {
  const touch = event.changedTouches[0];
  if (touch && swipeStart && touch.clientY - swipeStart.y >= touchTarget
    && touch.clientY - swipeStart.y > Math.abs(touch.clientX - swipeStart.x)) close();
  swipeStart = undefined;
}
let previousFocus: HTMLElement | null = null;
onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  if (!disposed) sheet.value?.focus();
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(compositionEndTimer);
  if (previousFocus?.isConnected) previousFocus.focus();
  // getStorage() is shared by the app: release listeners, never close its database here.
});
</script>

<template>
  <main ref="root" class="tags-page" :style="theme">
    <section ref="sheet" class="tags-sheet" role="dialog" aria-labelledby="tags-title"
      aria-describedby="tags-place" tabindex="-1" @keydown.esc.stop.prevent="close">
      <header @touchstart.passive="startSwipe" @touchend.passive="endSwipe" @touchcancel="swipeStart = undefined">
        <div class="sheet-handle" aria-hidden="true"></div>
        <div class="sheet-heading">
          <div>
            <h1 id="tags-title">タグを付ける・作る</h1>
            <p id="tags-place" class="secondary">{{ place?.name ?? '場所が見つかりません' }}</p>
          </div>
          <button type="button" class="close-button" aria-label="閉じる" @click="close"><span aria-hidden="true">×</span></button>
        </div>
      </header>

      <Banner v-if="memoryOnly" class="tags-banner" title="端末に保存できていません"
        body="変更はメモリにだけ残っています。このまま操作できますが、画面を再読み込みすると消えます。" />
      <Banner v-if="error" class="tags-banner" title="タグの操作を完了できませんでした" :body="error"
        :actions="[{ label: 'もう一度読み込む', variant: 'secondary', disabled: loading || busy, onPress: () => { reload++; } }]" />

      <section v-if="!place" class="empty-state" aria-labelledby="missing-place-title">
        <h2 id="missing-place-title">場所の情報がありません</h2>
        <p class="secondary">地図に戻り、タグを付ける場所を選んでください。</p>
        <button type="button" class="secondary-button" @click="close">地図に戻る</button>
      </section>
      <template v-else>
        <p v-if="loading" role="status">タグを読み込んでいます…</p>
        <section v-else aria-label="タグの一覧" :aria-busy="busy">
          <button v-for="tag in orderedTags" :key="tag.id" type="button" class="check-row" role="checkbox"
            :aria-checked="selected.includes(tag.id)" :aria-label="tag.title" :disabled="!canEdit" @click="toggle(tag.id)">
            <Icon class="tag-icon" :name="tag.id === 'want-to-go' ? 'flag' : tag.id === 'favorite' ? 'star' : 'tag'" :size="22" />
            <span class="tag-label">{{ tag.title }}<small class="secondary">{{ tag.builtin ? '最初からあるタグ' : '自分で作ったタグ' }}</small></span>
            <span class="check-mark" aria-hidden="true"><Icon v-if="selected.includes(tag.id)" name="check" :size="16" /></span>
          </button>
        </section>

        <form aria-label="新しいタグを作る" @submit.prevent="createTag">
          <label for="new-tag-title" class="visually-hidden">新しいタグの名前</label>
          <div class="create-row">
            <input id="new-tag-title" v-model="title" type="text" autocomplete="off" placeholder="タグの名前" :disabled="!canEdit"
              :aria-invalid="!!inputError" :aria-describedby="inputError ? 'tag-help tag-input-error' : 'tag-help'"
              @input="inputError = ''" @compositionstart="startComposition" @compositionend="endComposition"
              @keydown.enter="guardImeEnter">
            <Button type="submit" label="作る" :disabled="!canEdit" />
          </div>
          <p v-if="inputError" id="tag-input-error" class="input-error" role="alert">{{ inputError }}</p>
          <p id="tag-help" class="secondary">タグはこの端末の中にだけ保存し、他の来場者には見えません。ブラウザーのデータ削除などで消えることがあります。作ると、この場所にそのまま付きます。</p>
        </form>
      </template>
    </section>
  </main>
</template>

<style scoped>
.tags-page { min-height: 100dvh; display: flex; align-items: flex-end; background: var(--app-bg-page); color: var(--app-text-primary); font-family: var(--app-font); font-size: var(--body-size); }
.tags-page * { box-sizing: border-box; }
.tags-sheet { width: 100%; max-height: 100dvh; overflow-y: auto; padding: var(--space-4); border: 1px solid var(--app-border-subtle); border-radius: var(--sheet-radius) var(--sheet-radius) 0 0; background: var(--app-bg-surface); box-shadow: var(--shadow); }
.sheet-handle { width: var(--touch); height: var(--space-1); margin: 0 0 var(--space-4); border-radius: var(--radius); background: var(--app-border-subtle); }
.sheet-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); }
h1, h2, p { margin: 0; }
h1 { font-size: var(--title-size); font-weight: var(--app-bold); }
h2 { font-size: inherit; }
p { margin-top: var(--space-2); }
.secondary { color: var(--app-text-secondary); font-size: var(--small-size); }
.close-button, .secondary-button, .check-row, input { font: inherit; color: inherit; }
.close-button, .secondary-button, .check-row { cursor: pointer; }
.close-button:disabled, .secondary-button:disabled, .check-row:disabled, input:disabled { opacity: var(--app-disabled); cursor: default; }
.close-button:focus-visible, .secondary-button:focus-visible, .check-row:focus-visible, input:focus-visible, .tags-sheet:focus-visible { outline: 2px solid var(--app-action-primary); outline-offset: var(--space-1); }
.close-button:active:not(:disabled), .secondary-button:active:not(:disabled), .check-row:active:not(:disabled) { background-image: linear-gradient(var(--app-state-pressed), var(--app-state-pressed)); }
.close-button, .secondary-button { min-height: var(--touch); border: 1px solid var(--app-border-subtle); border-radius: var(--radius); background: var(--app-bg-surface); }
.close-button { min-width: var(--touch); font-size: var(--title-size); }
.secondary-button { margin-top: var(--space-3); padding: var(--space-2) var(--space-4); }
.tags-banner { margin-top: var(--space-4); }
/* CheckRow: 左に行頭アイコン、右にチェックの箱（選択中は lilac 塗り+ チェック） */
.check-row { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: var(--row-height); padding: var(--space-2) 0; text-align: left; border: 0; border-bottom: 1px solid var(--app-border-subtle); background: var(--app-bg-surface); }
.tag-icon { flex-shrink: 0; color: var(--app-text-secondary); }
.tag-label { flex: 1; overflow-wrap: anywhere; }
.tag-label small { display: block; }
.check-mark { display: flex; align-items: center; justify-content: center; width: var(--space-6); height: var(--space-6); flex-shrink: 0; border: 2px solid var(--app-action-primary); border-radius: var(--radius); }
.check-row[aria-checked='true'] .check-mark { background: var(--app-action-primary); color: var(--app-action-on-primary); }
/* TagCreateField: 入力欄 + 右に「作る」の 1 行。エラーは下に赤い文 */
form { display: grid; gap: var(--space-2); margin-top: var(--space-6); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.create-row { display: flex; gap: var(--space-3); align-items: center; }
input { flex: 1; min-width: 0; min-height: var(--touch); padding: var(--space-3); border: 1px solid var(--app-border-control); border-radius: var(--radius); background: var(--app-bg-page); }
input[aria-invalid='true'] { border-color: var(--app-danger); }
form p { margin: 0; }
.input-error { color: var(--app-danger-text); font-size: var(--small-size); }
.empty-state { margin-top: var(--space-6); }
</style>
