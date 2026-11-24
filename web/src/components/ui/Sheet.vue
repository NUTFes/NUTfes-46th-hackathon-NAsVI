<script setup lang="ts">
import { useId } from 'vue';
import IconButton from './IconButton.vue';

withDefaults(defineProps<{
  title: string;
  subtitle?: string;
  level?: 1 | 2; // 見出しの段。画面の主題になるシートは 1
}>(), { subtitle: undefined, level: 2 });

const emit = defineEmits<{ close: [] }>();
const titleId = useId();
</script>

<template>
  <section class="nv-sheet" :aria-labelledby="titleId">
    <span class="nv-sheet__handle" aria-hidden="true" />
    <header class="nv-sheet__head">
      <div class="nv-sheet__titles">
        <component :is="`h${level}`" :id="titleId" class="nv-sheet__title">{{ title }}</component>
        <p v-if="subtitle" class="nv-sheet__subtitle">{{ subtitle }}</p>
      </div>
      <IconButton icon="close" label="閉じる" @press="emit('close')" />
    </header>
    <div class="nv-sheet__body"><slot /></div>
  </section>
</template>

<style scoped>
/* Sheet.md: bg-surface / border-subtle / radius.2xl。影のトークンは無いので黒の薄い影を直に置く */
.nv-sheet {
  box-sizing: border-box;
  position: relative;
  padding: var(--app-space-4, 16px);
  background: var(--app-bg-surface);
  border: 1px solid var(--app-border-subtle);
  border-bottom: 0;
  border-radius: var(--app-radius-2xl, 18px) var(--app-radius-2xl, 18px) 0 0;
  box-shadow: 0 -8px 24px rgb(0 0 0 / 0.3);
  color: var(--app-text-primary);
  font-family: var(--app-font, inherit);
}
.nv-sheet__handle {
  display: block;
  width: 40px;
  height: 4px;
  margin: -4px 0 var(--app-space-3, 12px);
  border-radius: 2px;
  background: var(--app-action-primary);
  opacity: 0.6;
}
.nv-sheet__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--app-space-3, 12px); }
.nv-sheet__titles { min-width: 0; }
.nv-sheet__title { margin: 0; font-size: 16px; font-weight: 800; line-height: 1.35; }
.nv-sheet__subtitle { margin: 4px 0 0; color: var(--app-text-secondary); font-size: var(--app-body, 13px); line-height: 1.5; }
.nv-sheet__body { margin-top: var(--app-space-4, 16px); }
</style>
