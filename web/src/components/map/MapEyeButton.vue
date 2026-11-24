<script setup lang="ts">
import Icon from '../ui/Icon.vue';
withDefaults(defineProps<{ label?: string }>(), { label: '表示する印を選ぶ' });
const emit = defineEmits<{ press: [] }>();
</script>
<template><button type="button" :aria-label="label" aria-haspopup="dialog" @click="emit('press')"><Icon name="layers" :size="20" /><span>表示</span></button></template>
<style scoped>
button { box-sizing: border-box; display: flex; align-items: center; justify-content: center; padding: 0; border: 1px solid var(--app-border-subtle); border-radius: 14px; background: var(--app-bg-surface); color: var(--app-text-primary); cursor: pointer; font-family: var(--app-font, inherit); }
button:focus-visible { outline: 2px solid var(--app-action-primary); outline-offset: 4px; }
button:active:not(:disabled) { background: var(--app-state-pressed); }
button { width: 44px; height: 50px; flex-direction: column; gap: 2px; font-size: 11px; font-weight: 700; line-height: 1; }
</style>
