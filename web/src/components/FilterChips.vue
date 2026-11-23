<script setup lang="ts">
import { computed } from 'vue';
import type { FilterState, Label, MyTag } from '../types';

const props = defineProps<{
  labels: Label[];
  tags: MyTag[];
  modelValue: FilterState;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: FilterState] }>();

// Chip.md と tokens.css のトークン対応。scoped CSS はこの別名だけを参照する。
const TOKENS = {
  '--chips-surface': 'var(--bg-surface)',
  '--chips-border': 'var(--border-subtle)',
  '--chips-text': 'var(--text-secondary)',
  '--chips-selected': 'var(--action-primary)',
  '--chips-on-selected': 'var(--action-on-primary)',
  '--chips-gap': 'var(--space-2)',
  '--chips-padding': 'var(--space-3)',
  '--chips-unit': 'var(--space-4)',
  '--chips-radius': 'var(--radius-pill)',
  '--chips-target': 'var(--touch-target)',
  '--chips-font': 'var(--font-base)',
};
// tokens.css の .label（文字サイズには公開 CSS 変数がない）。
const TYPOGRAPHY = {
  '--chips-font-size': '13px',
  '--chips-line-height': '1.4',
  '--chips-font-weight': '700',
};

const groups = computed(() => [
  { key: 'labelIds' as const, title: '種類', items: props.labels },
  { key: 'tagIds' as const, title: '自分用タグ', items: props.tags },
].filter(({ items }) => items.length > 0));

function toggle(key: keyof FilterState, id: string) {
  const next: FilterState = {
    labelIds: [...props.modelValue.labelIds],
    tagIds: [...props.modelValue.tagIds],
  };
  next[key] = next[key].includes(id)
    ? next[key].filter((selectedId) => selectedId !== id)
    : [...next[key], id];
  emit('update:modelValue', next);
}
</script>

<template>
  <div
    v-if="groups.length"
    class="filter-chips"
    role="group"
    aria-label="場所の絞り込み"
    :style="[TOKENS, TYPOGRAPHY]"
  >
    <template v-for="(group, index) in groups" :key="group.key">
      <span v-if="index > 0" class="filter-chips__divider" aria-hidden="true" />
      <div class="filter-chips__group" role="group" :aria-label="group.title">
        <button
          v-for="item in group.items"
          :key="item.id"
          type="button"
          class="filter-chips__button"
          :aria-pressed="modelValue[group.key].includes(item.id)"
          @click="toggle(group.key, item.id)"
        >
          <span class="filter-chips__face">
            <span
              v-if="modelValue[group.key].includes(item.id)"
              class="filter-chips__check"
              aria-hidden="true"
            >✓</span>
            {{ item.title }}
          </span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.filter-chips,
.filter-chips__group {
  display: flex;
  align-items: center;
  gap: var(--chips-gap);
}

.filter-chips {
  overflow-x: auto;
  padding: var(--chips-gap);
  font-family: var(--chips-font);
  font-size: var(--chips-font-size);
  line-height: var(--chips-line-height);
  font-weight: var(--chips-font-weight);
}

.filter-chips__group {
  flex: none;
}

.filter-chips__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  min-width: var(--chips-target);
  min-height: var(--chips-target);
  padding: 0;
  border: 0;
  border-radius: var(--chips-radius);
  background: transparent;
  color: var(--chips-text);
  font: inherit;
  cursor: pointer;
}

.filter-chips__face {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--chips-gap);
  /* Chip.md の見た目は 32px（space-4 × 2）、ボタン本体は touch-target。 */
  height: calc(var(--chips-unit) * 2);
  min-width: var(--chips-target);
  padding-inline: var(--chips-padding);
  border: 1px solid var(--chips-border);
  border-radius: var(--chips-radius);
  background: var(--chips-surface);
  white-space: nowrap;
}

.filter-chips__button[aria-pressed='true'] .filter-chips__face {
  border-color: var(--chips-selected);
  background: var(--chips-selected);
  color: var(--chips-on-selected);
}

.filter-chips__button:focus-visible {
  outline: 2px solid var(--chips-selected);
  outline-offset: calc(var(--chips-gap) / 2);
}

.filter-chips__divider {
  flex: none;
  height: var(--chips-unit);
  border-inline-start: 1px solid var(--chips-border);
}
</style>
