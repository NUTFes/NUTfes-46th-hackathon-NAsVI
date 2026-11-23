<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import tokens from '../../../design-system/tokens.json';
import { distanceM } from '../domain/geo';
import { usePosition } from '../services/position';
import { useLandmarksStore, usePlacesStore } from '../stores';
import { BUILTIN_TAGS, getStorage, type TagLink } from '../storage';
import type { Place } from '../types';
import Button from '../components/ui/Button.vue';
import Icon from '../components/ui/Icon.vue';
import IconButton from '../components/ui/IconButton.vue';

type TokenColor = { hex: string; alpha?: number };
function cssColor(value: string | TokenColor): string {
  if (typeof value === 'string') {
    const [, , hue, shade] = value.slice(1, -1).split('.');
    const palette = tokens.color.palette as Record<string, Record<string, { $value: TokenColor }>>;
    return cssColor(palette[hue][shade].$value);
  }
  return value.alpha === undefined ? value.hex
    : `${value.hex}${Math.round(value.alpha * 255).toString(16).padStart(2, '0')}`;
}
function dimension(value: { value: number; unit: string }): string {
  return `${value.value}${value.unit}`;
}

// 見た目の定数はここだけ。design-system/tokens.json の名前を固定し、
// PlaceCard / Button / Chip / Sheet / IconButton.md の意味トークンを共有する。
const colorNames = [
  'bg-surface', 'text-primary', 'text-secondary', 'border-subtle',
  'action-primary', 'action-on-primary', 'action-selected-bg', 'destination', 'destination-on',
  'destination-border', 'event', 'parking', 'facility', 'danger-text', 'state-pressed',
] as const;
const CARD_TOKENS = {
  ...Object.fromEntries((['dark', 'light'] as const).flatMap(theme => colorNames.map(name =>
    [`--pc-${theme}-${name}`, cssColor(tokens.color[theme][name].$value)]))), // color.{dark,light}.<name>
  '--pc-gap-small': dimension(tokens.space['1'].$value), // space.1
  '--pc-gap': dimension(tokens.space['2'].$value), // space.2
  '--pc-section-gap': dimension(tokens.space['3'].$value), // space.3
  '--pc-padding': dimension(tokens.space['4'].$value), // space.4
  '--pc-radius': dimension(tokens.radius['2xl'].$value), // radius.2xl (Sheet)
  '--pc-control-radius': dimension(tokens.radius.md.$value), // radius.md
  '--pc-touch': dimension(tokens.size['touch-target'].$value), // size.touch-target
  '--pc-font': tokens.font.family.base.$value.map(name => name === 'sans-serif' ? name : JSON.stringify(name)).join(', '), // font.family.base (端末フォントのみ)
  '--pc-caption': dimension(tokens.font.size.xs.$value), // font.size.xs
  '--pc-body': dimension(tokens.font.size.sm.$value), // font.size.sm
  '--pc-title': dimension(tokens.font.size['2xl'].$value), // font.size.2xl
  '--pc-distance': dimension(tokens.font.size['4xl'].$value), // font.size.4xl
  '--pc-weight': tokens.font.weight.regular.$value, // font.weight.regular
  '--pc-bold': tokens.font.weight.bold.$value, // font.weight.bold
  '--pc-heavy': tokens.font.weight['extra-bold'].$value, // font.weight.extra-bold
  '--pc-disabled': tokens.opacity.disabled.$value, // opacity.disabled
  '--pc-shadow': [ // shadow.sheet
    dimension(tokens.shadow.sheet.$value.offsetX), dimension(tokens.shadow.sheet.$value.offsetY),
    dimension(tokens.shadow.sheet.$value.blur), dimension(tokens.shadow.sheet.$value.spread),
    cssColor(tokens.shadow.sheet.$value.color),
  ].join(' '),
};

const TAG_ICONS: Record<string, 'bookmark' | 'star'> = { 'want-to-go': 'bookmark', favorite: 'star' };

const route = useRoute();
const router = useRouter();
const places = usePlacesStore();
const landmarks = useLandmarksStore();
const { position } = usePosition(); // 許可要求・取得開始はしない。共有済みの端末内の位置だけ読む。
const placeId = computed(() => typeof route.params.id === 'string' ? route.params.id : '');
const place = computed(() => places.items.find(item => item.id === placeId.value));
// 暫定: W-05 / W-03 / W-09 のストアが読み込み完了の印を用意するまでは、
// 空の一覧を未取得として扱う。読み込み中・取得失敗を削除と誤認しない。
const loading = computed(() => places.items.length === 0);
// API-36 / D-030: 設備を企画として扱わず、表示上の kind を facility にまとめる。
const kind = computed(() => place.value?.kind === 'event' || place.value?.kind === 'parking'
  ? place.value.kind : 'facility');
const kindTitle = computed(() => ({ event: '企画', parking: '駐車場', facility: '設備' })[kind.value]);
const building = computed(() => landmarks.items.find(item => item.id === place.value?.landmarkId)?.name);
const floor = computed(() => {
  const value = place.value?.floor;
  return value == null ? '' : value < 0 ? `地下${Math.abs(value)}階` : `${value}階`;
});
const locationText = computed(() => [building.value, floor.value, kindTitle.value].filter(Boolean).join('・'));
const distance = computed(() => place.value && position.value
  ? Math.round(distanceM(position.value, place.value.location)) : null);

// D-020 / API-35: 日時の組から表示文字列を作る唯一の箇所。会場の日本時間で、日付も残す。
function formatHours(hours: Place['hours']): string {
  const date = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' });
  const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return hours.map(({ start, end }) => {
    const from = new Date(start);
    const to = new Date(end);
    const endDate = date.format(from) === date.format(to) ? '' : `${date.format(to)} `;
    return `${date.format(from)} ${time.format(from)}〜${endDate}${time.format(to)}`;
  }).join('\n');
}
const hours = computed(() => formatHours(place.value?.hours ?? []));
const heading = ref<HTMLElement | null>(null);
const links = ref<TagLink[]>([]);
const tagsReady = ref(false);
const pendingTag = ref<string | null>(null);
const choosing = ref(false);
const error = ref('');

watch(placeId, async (id, _previous, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  links.value = [];
  tagsReady.value = false;
  error.value = '';
  await nextTick();
  if (!current) return;
  heading.value?.focus();
  try {
    const storedLinks = await (await getStorage()).tagLinks.list(id);
    if (current) {
      links.value = storedLinks;
      tagsReady.value = true;
    }
  } catch {
    if (current) error.value = 'タグを読み込めませんでした。カードを開き直してください。';
  }
}, { immediate: true });

function hasTag(tagId: string): boolean {
  return links.value.some(link => link.tagId === tagId);
}
async function toggleTag(tagId: string) {
  if (!place.value || !tagsReady.value || pendingTag.value !== null) return;
  const id = placeId.value;
  const selected = hasTag(tagId);
  pendingTag.value = tagId;
  error.value = '';
  try {
    const storage = await getStorage();
    if (selected) await storage.tagLinks.delete(id, tagId);
    else await storage.tagLinks.save({ placeId: id, tagId });
    const storedLinks = await storage.tagLinks.list(id);
    if (placeId.value === id) links.value = storedLinks;
  } catch {
    if (placeId.value === id) error.value = 'タグを変更できませんでした。もう一度お試しください。';
  } finally {
    pendingTag.value = null;
  }
}
async function go() {
  if (!place.value || choosing.value) return;
  const id = placeId.value;
  choosing.value = true;
  error.value = '';
  try {
    // D-013: 書き込みは明示的な操作時だけ。座標は保存・送信しない。
    await (await getStorage()).destination.save({ placeId: id });
    if (placeId.value === id && place.value) await router.push({ name: 'guide' });
  } catch {
    if (placeId.value === id) error.value = '行き先を保存できませんでした。もう一度お試しください。';
  } finally {
    choosing.value = false;
  }
}
function close() {
  void router.push({ name: 'map' });
}
function trapFocus(event: KeyboardEvent) {
  const card = event.currentTarget as HTMLElement;
  // カード内の操作要素はすべてボタン。保存中などの無効なものは飛ばす。
  const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const index = buttons.findIndex(button => button === card.ownerDocument.activeElement);
  const next = index < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
    : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
  (buttons[next] ?? heading.value)?.focus();
}
</script>

<template>
  <main
    class="place-card" :style="CARD_TOKENS" :data-kind="kind"
    role="dialog" aria-modal="true" aria-labelledby="place-card-title"
    @keydown.esc="close" @keydown.tab.prevent="trapFocus"
  >
    <template v-if="place">
      <header class="card-top">
        <div class="card-heading">
          <p class="eyebrow">{{ locationText }}</p>
          <h1 id="place-card-title" ref="heading" tabindex="-1">{{ place.name }}</h1>
        </div>
        <div class="distance" aria-live="polite">
          <template v-if="distance !== null">
            <strong><span class="num">{{ distance }}</span><span class="unit">m</span></strong>
            <span class="note">直線</span>
          </template>
          <span v-else class="note">現在地が未取得のため<br>直線距離を表示できません</span>
        </div>
      </header>
      <p v-if="place.description" class="description">{{ place.description }}</p>
      <p v-if="hours" class="hours">{{ hours }}</p>
      <div class="tags" aria-label="自分用のタグ">
        <button
          v-for="tag in BUILTIN_TAGS" :key="tag.id" type="button" class="tag"
          :aria-pressed="hasTag(tag.id)" :disabled="!tagsReady || pendingTag !== null"
          @click="toggleTag(tag.id)"
        >
          <Icon :name="TAG_ICONS[tag.id] ?? 'tag'" :size="16" :filled="hasTag(tag.id)" />{{ tag.title }}
        </button>
        <button type="button" class="tag" @click="router.push({ name: 'tags', params: { id: placeId } })">
          <Icon name="plus" :size="16" /><span class="sr-only">＋ </span>タグ
        </button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <Button class="go" label="ここへ向かう" variant="destination" icon="navigation" icon-filled size="lg" :disabled="choosing" @press="go" />
        <IconButton class="close" icon="close" label="閉じる" @press="close" />
      </div>
    </template>
    <template v-else>
      <h1 id="place-card-title" ref="heading" tabindex="-1">場所のカード</h1>
      <p v-if="loading" role="status">読み込み中…</p>
      <p v-else class="error" role="alert">この場所は見られなくなりました</p>
      <Button class="close" label="閉じる" variant="secondary" :disabled="loading" @press="close" />
    </template>
  </main>
</template>

<style scoped>
.place-card {
  --pc-surface: var(--pc-dark-bg-surface);
  --pc-text: var(--pc-dark-text-primary);
  --pc-secondary: var(--pc-dark-text-secondary);
  --pc-border: var(--pc-dark-border-subtle);
  --pc-action: var(--pc-dark-action-primary);
  --pc-on-action: var(--pc-dark-action-on-primary);
  --pc-destination: var(--pc-dark-destination);
  --pc-on-destination: var(--pc-dark-destination-on);
  --pc-destination-border: var(--pc-dark-destination-border);
  --pc-event: var(--pc-dark-event);
  --pc-parking: var(--pc-dark-parking);
  --pc-facility: var(--pc-dark-facility);
  --pc-danger: var(--pc-dark-danger-text);
  --pc-pressed: var(--pc-dark-state-pressed);
  --pc-selected: var(--pc-dark-action-selected-bg);
  /* 位置・重なりは呼び出し側(visitor-overlay)に任せる。カードは中身だけ。 */
  margin: var(--pc-padding);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--pc-section-gap);
  padding: var(--pc-padding);
  background: var(--pc-surface);
  color: var(--pc-text);
  border: thin solid var(--pc-border);
  border-radius: var(--pc-radius);
  box-shadow: var(--pc-shadow);
  font-family: var(--pc-font);
  font-size: var(--pc-body);
  font-weight: var(--pc-weight);
  line-height: normal;
}
[data-theme='light'] .place-card {
  --pc-surface: var(--pc-light-bg-surface);
  --pc-text: var(--pc-light-text-primary);
  --pc-secondary: var(--pc-light-text-secondary);
  --pc-border: var(--pc-light-border-subtle);
  --pc-action: var(--pc-light-action-primary);
  --pc-on-action: var(--pc-light-action-on-primary);
  --pc-destination: var(--pc-light-destination);
  --pc-on-destination: var(--pc-light-destination-on);
  --pc-destination-border: var(--pc-light-destination-border);
  --pc-event: var(--pc-light-event);
  --pc-parking: var(--pc-light-parking);
  --pc-facility: var(--pc-light-facility);
  --pc-danger: var(--pc-light-danger-text);
  --pc-pressed: var(--pc-light-state-pressed);
  --pc-selected: var(--pc-light-action-selected-bg);
}
.card-top, .tags, .actions { display: flex; gap: var(--pc-gap); }
.card-top { align-items: flex-start; }
.card-heading { flex: 1; min-width: 0; }
h1, p { margin: 0; overflow-wrap: anywhere; }
h1 { font-size: var(--pc-title); font-weight: var(--pc-heavy); }
.eyebrow { font-size: var(--pc-caption); font-weight: var(--pc-bold); color: var(--pc-event); }
[data-kind='parking'] .eyebrow { color: var(--pc-parking); }
[data-kind='facility'] .eyebrow { color: var(--pc-facility); }
.description, .hours { color: var(--pc-secondary); white-space: pre-line; }
.distance { text-align: end; color: var(--pc-secondary); font-size: var(--pc-caption); }
.distance strong { display: block; color: var(--pc-text); font-size: var(--pc-distance); font-weight: var(--pc-bold); line-height: 1.1; }
.distance .unit { margin-inline-start: 2px; font-size: var(--pc-body); }
.distance .note { display: block; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tags { flex-wrap: wrap; }
.tag {
  display: inline-flex; align-items: center; gap: var(--pc-gap-small);
  min-height: var(--pc-touch); padding: var(--pc-gap-small) var(--pc-section-gap);
  border: thin solid var(--pc-border); border-radius: var(--pc-control-radius);
  background: var(--pc-surface); color: var(--pc-secondary);
  font: inherit; font-weight: var(--pc-bold); cursor: pointer;
}
.tag[aria-pressed='true'] { background: var(--pc-selected); border-color: var(--pc-action); color: var(--pc-text); }
.tag[aria-pressed='true'] svg { color: var(--pc-action); }
.tag:active:not(:disabled) { background-image: linear-gradient(var(--pc-pressed), var(--pc-pressed)); }
.tag:focus-visible { outline: solid var(--pc-action); }
.tag:disabled { opacity: var(--pc-disabled); cursor: default; }
.go { flex: 1; }
.error { color: var(--pc-danger); }
</style>
