<script setup lang="ts">
import Icon from './Icon.vue';
import IconButton from './IconButton.vue';

withDefaults(defineProps<{
  modelValue?: string;
  placeholder?: string; // 読み上げの名前にもなる（見出しは出さない）
  naturalSearch?: boolean; // 拡張「文章で探す」を出す（OQ-8）
}>(), { modelValue: '', placeholder: '企画・場所を検索', naturalSearch: false });

const emit = defineEmits<{ 'update:modelValue': [value: string]; clear: []; natural: [] }>();

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <label class="nv-search">
    <Icon name="search" :size="20" />
    <input
      type="search"
      class="nv-search__input"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="placeholder"
      @input="onInput"
    />
    <IconButton
      v-if="modelValue"
      class="nv-search__clear"
      icon="close"
      label="入力を消す"
      plain
      :size="18"
      @press="emit('update:modelValue', ''); emit('clear')"
    />
    <button v-if="naturalSearch" type="button" class="nv-search__natural" @click="emit('natural')">文章で探す(拡張)</button>
  </label>
</template>

<style scoped>
.nv-search {
  box-sizing: border-box;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px 0 14px;
  background: var(--app-bg-surface); /* bg-surface */
  border: 1px solid var(--app-border-control, var(--border-control)); /* border-control */
  border-radius: var(--app-radius-xl, 14px); /* radius.xl */
  color: var(--app-text-secondary);
}
.nv-search:focus-within { border-color: var(--app-action-primary); outline: 1px solid var(--app-action-primary); } /* 入力中は枠の色と太さを変える */
.nv-search__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: none;
  border: 0;
  outline: 0;
  color: var(--app-text-primary);
  font-family: var(--app-font, inherit);
  font-size: var(--app-input, 16px); /* font.size.xl 相当（16px 入力） */
  font-weight: 500;
}
.nv-search__input::placeholder { color: var(--app-text-secondary); }
.nv-search__input::-webkit-search-cancel-button { display: none; }
.nv-search__natural {
  flex: none;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--app-radius-sm, 8px);
  border: 1px dashed var(--app-border-control, var(--border-control));
  background: none;
  color: var(--app-text-secondary);
  font-family: var(--app-font, inherit);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}
</style>
