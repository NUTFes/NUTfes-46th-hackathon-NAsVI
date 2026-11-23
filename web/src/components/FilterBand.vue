<script setup lang="ts">
defineProps<{
  labels: string[];
  // 呼び出し側が applyFilter の結果から数える。設備は D-030 に従う。
  count?: number;
  emptyHint?: string;
}>();
const emit = defineEmits<{ clear: [] }>();

// FilterBand.md と tokens.css のトークン対応。scoped CSS はこの別名だけを参照する。
const TOKENS = {
  '--band-surface': 'var(--bg-surface)',
  '--band-border': 'var(--border-subtle)',
  '--band-text': 'var(--text-primary)',
  '--band-hint': 'var(--text-secondary)',
  '--band-action': 'var(--action-primary)',
  '--band-gap': 'var(--space-2)',
  '--band-padding': 'var(--space-3)',
  '--band-icon': 'var(--space-4)',
  '--band-radius': 'var(--radius-sm)',
  '--band-target': 'var(--touch-target)',
  '--band-font': 'var(--font-base)',
};
// tokens.css の .label（本文）、.body（補足）、.action（解除）。
const TYPOGRAPHY = {
  '--band-font-size': '13px',
  '--band-line-height': '1.4',
  '--band-font-weight': '700',
  '--band-hint-line-height': '1.5',
  '--band-hint-font-weight': '400',
  '--band-action-font-size': '14px',
};
</script>

<template>
  <div v-if="labels.length" class="filter-band" role="status" :style="[TOKENS, TYPOGRAPHY]">
    <svg
      class="filter-band__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 4h18l-7 8v6l-4 2v-8z" />
    </svg>
    <div class="filter-band__message">
      <p class="filter-band__summary">『{{ labels.join('・') }}』で絞り込み中<span v-if="count !== undefined">・{{ count }} 件</span></p>
      <p v-if="count === 0 && emptyHint" class="filter-band__hint">{{ emptyHint }}</p>
    </div>
    <button type="button" class="filter-band__clear" @click="emit('clear')">解除</button>
  </div>
</template>

<style scoped>
.filter-band {
  display: flex;
  align-items: center;
  gap: var(--band-gap);
  padding: var(--band-gap) var(--band-padding);
  border: 1px solid var(--band-border);
  border-radius: var(--band-radius);
  background: var(--band-surface);
  color: var(--band-text);
  font-family: var(--band-font);
  font-size: var(--band-font-size);
  line-height: var(--band-line-height);
  font-weight: var(--band-font-weight);
}

.filter-band__icon {
  flex: none;
  width: var(--band-icon);
  height: var(--band-icon);
}

.filter-band__message {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.filter-band__summary,
.filter-band__hint {
  margin: 0;
}

.filter-band__hint {
  color: var(--band-hint);
  line-height: var(--band-hint-line-height);
  font-weight: var(--band-hint-font-weight);
}

.filter-band__clear {
  flex: none;
  min-width: var(--band-target);
  min-height: var(--band-target);
  padding: 0 var(--band-gap);
  border: 0;
  border-radius: var(--band-radius);
  background: transparent;
  color: var(--band-action);
  font: inherit;
  font-size: var(--band-action-font-size);
  cursor: pointer;
}

.filter-band__clear:focus-visible {
  outline: 2px solid var(--band-action);
  outline-offset: calc(var(--band-gap) / 2);
}
</style>
