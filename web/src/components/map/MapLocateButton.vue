<script setup lang="ts">
import Icon from '../ui/Icon.vue';
withDefaults(defineProps<{ label: string; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ press: [] }>();
</script>
<template><button class="locate-button" type="button" :aria-label="label" :disabled="disabled" @click="emit('press')"><Icon :name="disabled ? 'locate-off' : 'locate'" :size="20" /></button></template>
<style scoped>
button { box-sizing: border-box; display: flex; align-items: center; justify-content: center; padding: 0; border: 1px solid var(--app-border-subtle); border-radius: 14px; background: var(--app-bg-surface); color: var(--app-text-primary); cursor: pointer; font-family: var(--app-font, inherit); }
button:focus-visible { outline: 2px solid var(--app-action-primary); outline-offset: 4px; }
button:active:not(:disabled) { background: var(--app-state-pressed); }
button { width: 44px; height: 44px; }
.locate-button:disabled { opacity: 1; color: var(--app-text-disabled); cursor: default; }
</style>
