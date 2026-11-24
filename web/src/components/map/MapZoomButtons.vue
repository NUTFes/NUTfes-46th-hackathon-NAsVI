<script setup lang="ts">
import Icon from '../ui/Icon.vue';
withDefaults(defineProps<{ zoomInDisabled?: boolean; zoomOutDisabled?: boolean }>(), { zoomInDisabled: false, zoomOutDisabled: false });
const emit = defineEmits<{ zoomIn: []; zoomOut: [] }>();
</script>
<template><div class="zoom" role="group" aria-label="地図の倍率">
<button type="button" :disabled="zoomInDisabled" :aria-label="zoomInDisabled ? 'これ以上は拡大できません' : '地図を拡大'" @click="emit('zoomIn')"><Icon name="zoom-in" :size="20" /></button>
<button type="button" :disabled="zoomOutDisabled" :aria-label="zoomOutDisabled ? 'これ以上は縮小できません' : '地図を縮小'" @click="emit('zoomOut')"><Icon name="zoom-out" :size="20" /></button>
</div></template>
<style scoped>
button { box-sizing: border-box; display: flex; align-items: center; justify-content: center; padding: 0; border: 1px solid var(--app-border-subtle); border-radius: 14px; background: var(--app-bg-surface); color: var(--app-text-primary); cursor: pointer; font-family: var(--app-font, inherit); }
button:focus-visible { outline: 2px solid var(--app-action-primary); outline-offset: 4px; }
button:active:not(:disabled) { background: var(--app-state-pressed); }
.zoom { width: 44px; border-radius: 14px; background: var(--app-bg-surface); box-shadow: inset 0 0 0 1px var(--app-border-subtle); }
button { width: 44px; height: 44px; background: transparent; border-radius: 14px 14px 0 0; border-bottom: 0; }
button + button { border-radius: 0 0 14px 14px; border-bottom: 1px solid var(--app-border-subtle); }
.zoom button:disabled { opacity: 0.4; cursor: default; }
</style>
