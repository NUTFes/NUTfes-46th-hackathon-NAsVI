<script setup lang="ts">
import { computed } from 'vue';
import '../../../design-system/claude-design/tokens.css';
import Badge from './ui/Badge.vue';
import Icon from './ui/Icon.vue';

type Tags = { wantToGo: boolean; favorite: boolean };
const props = defineProps<{
  placeId: string;
  name: string;
  kindLabel?: string;
  building?: string;
  floor?: string;
  distanceM?: number;
  highlight?: string;
  tags?: Tags;
  onOpen: () => void;
  onToggleTag?: (tag: keyof Tags, on: boolean) => void;
  isDestination?: boolean;
  loading?: boolean;
}>();

// design-system/claude-design/tokens.css の意味トークンと文字スタイル。
const TOKENS = {
  '--row-surface': 'var(--bg-surface)', // color.{dark,light}.bg-surface
  '--row-text': 'var(--text-primary)', // color.{dark,light}.text-primary
  '--row-muted': 'var(--text-secondary)', // color.{dark,light}.text-secondary
  '--row-border': 'var(--border-subtle)', // color.{dark,light}.border-subtle
  '--row-action': 'var(--action-primary)', // color.{dark,light}.action-primary
  '--row-selected': 'var(--action-selected-bg)', // color.{dark,light}.action-selected-bg
  '--row-pressed': 'var(--state-pressed)', // color.{dark,light}.state-pressed
  '--row-destination': 'var(--destination)', // color.{dark,light}.destination
  '--row-destination-border': 'var(--destination-border)', // color.{dark,light}.destination-border
  '--row-skeleton': 'var(--skeleton)', // color.{dark,light}.skeleton
  '--row-gap': 'var(--space-2)', // space.2
  '--row-padding': 'var(--space-3)', // space.3
  '--row-unit': 'var(--space-4)', // space.4
  '--row-radius': 'var(--radius-sm)', // radius.sm
  '--row-target': 'var(--touch-target)', // size.touch-target
  '--row-font': 'var(--font-base)', // font.family.base
  '--row-name-size': '15px', // typography.subtitle / font.size.lg
  '--row-name-weight': '700', // typography.subtitle / font.weight.bold
  '--row-name-line': '1.35', // typography.subtitle
  '--row-caption-size': '12px', // typography.caption / font.size.xs
  '--row-caption-line': '1.5', // typography.caption
  '--row-weight': '400', // font.weight.regular
} as const;

const distance = computed(() => props.distanceM !== undefined
  && Number.isFinite(props.distanceM) && props.distanceM >= 0 ? Math.round(props.distanceM) : undefined);
const openLabel = computed(() => [
  props.name, props.kindLabel, props.building, props.floor,
  distance.value !== undefined ? `${distance.value} メートル` : undefined,
].filter(Boolean).join('、'));

// NFKC・小文字化後の一致範囲を元の書記素に戻す。縮約(ｶﾞ)・展開(㍿、İ)でも
// 文字の重複・欠落や結合文字の分断を防ぎ、検索語や名前を HTML として解釈しない。
const nameParts = computed(() => {
  const word = props.highlight?.trim().normalize('NFKC').toLowerCase();
  if (!word) return [{ text: props.name, match: false }];
  const name = props.name.normalize('NFKC').toLowerCase();
  const matches: { start: number; end: number }[] = [];
  let index = name.indexOf(word);
  while (index !== -1) {
    matches.push({ start: index, end: index + word.length });
    index = name.indexOf(word, index + word.length);
  }
  const parts: { text: string; match: boolean }[] = [];
  let offset = 0;
  for (const { segment } of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(props.name)) {
    const end = offset + segment.normalize('NFKC').toLowerCase().length;
    const match = matches.some(range => range.start < end && range.end > offset);
    const previous = parts[parts.length - 1];
    if (previous && previous.match === match) previous.text += segment;
    else parts.push({ text: segment, match });
    offset = end;
  }
  return parts;
});
</script>

<template>
  <div class="place-row" :style="TOKENS" :aria-busy="loading || undefined" :data-place-id="placeId">
    <span v-if="isDestination" class="place-row__destination" role="img" aria-label="行き先" />
    <button
      type="button"
      class="place-row__open"
      :aria-label="openLabel"
      :disabled="loading"
      @click="onOpen()"
    >
      <span class="place-row__content">
        <span v-if="loading" class="place-row__skeleton" aria-hidden="true" />
        <span v-else class="place-row__name" :title="name">
          <template v-for="(part, index) in nameParts" :key="index"><mark v-if="part.match">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
        </span>
        <span v-if="kindLabel || building || floor" class="place-row__meta">
          <Badge v-if="kindLabel" class="place-row__kind" :label="kindLabel" />
          <span v-if="building">{{ building }}</span>
          <span v-if="floor">{{ floor }}</span>
        </span>
      </span>
      <span v-if="distance !== undefined" class="place-row__distance">{{ distance }} m</span>
    </button>
    <div v-if="tags" class="place-row__tags">
      <button
        v-for="tag in (['wantToGo', 'favorite'] as const)"
        :key="tag"
        type="button"
        class="place-row__tag"
        :aria-label="`${name}の${tag === 'wantToGo' ? '行きたい場所' : 'お気に入り'}`"
        :aria-pressed="tags[tag]"
        :disabled="loading || !onToggleTag"
        @click.stop="onToggleTag?.(tag, !tags[tag])"
      >
        <Icon :name="tag === 'wantToGo' ? 'bookmark' : 'star'" :size="22" :filled="tags[tag]" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.place-row {
  display: flex;
  align-items: center;
  position: relative;
  min-height: calc(var(--row-target) + var(--row-padding));
  border-bottom: 1px solid var(--row-border);
  background: var(--row-surface);
  color: var(--row-text);
  font-family: var(--row-font);
  font-weight: var(--row-weight);
}
.place-row button { color: inherit; font: inherit; cursor: pointer; }
.place-row__open {
  display: flex;
  align-items: center;
  gap: var(--row-gap);
  flex: 1;
  align-self: stretch;
  min-width: 0;
  min-height: var(--row-target);
  padding: var(--row-padding);
  border: 0;
  background: transparent;
  text-align: start;
}
.place-row__content { flex: 1; min-width: 0; }
.place-row__name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: var(--row-name-size);
  font-weight: var(--row-name-weight);
  line-height: var(--row-name-line);
}
.place-row mark { background: var(--row-selected); color: inherit; }
.place-row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--row-gap);
  margin-top: calc(var(--row-gap) / 2);
  color: var(--row-muted);
  font-size: var(--row-caption-size);
  line-height: var(--row-caption-line);
  overflow-wrap: anywhere;
}
.place-row__distance { flex: none; color: var(--row-muted); font-size: var(--row-caption-size); font-weight: 700; }
.place-row__tags { display: flex; flex: none; }
.place-row__tag {
  display: grid;
  place-items: center;
  width: var(--row-target);
  min-height: var(--row-target);
  padding: 0;
  border: 0;
  border-radius: var(--row-radius);
  background: transparent;
}
.place-row__tag[aria-pressed='true'] { color: var(--row-action); }
.place-row button:active { background: var(--row-pressed); }
.place-row button:focus-visible { outline: 2px solid var(--row-action); outline-offset: -2px; }
.place-row button:disabled { cursor: default; }
.place-row__destination {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  width: 4px;
  background: var(--row-destination);
}
.place-row__skeleton { display: block; height: var(--row-unit); width: 75%; border-radius: var(--row-radius); background: var(--row-skeleton); }
</style>
