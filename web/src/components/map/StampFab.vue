<script setup lang="ts">
import Icon from '../ui/Icon.vue';
withDefaults(defineProps<{ label: string; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ press: [] }>();
</script>
<template><button type="button" :aria-label="label" :disabled="disabled" @click="emit('press')"><Icon name="stamp" :size="22" /><span>スタンプ</span></button></template>
<style scoped>
@import "./map-parts.css";
button { width: 56px; height: 60px; flex-direction: column; gap: 2px; border: 0; border-radius: 18px; background: var(--app-action-primary); color: var(--app-action-on-primary); font-size: 11px; font-weight: 700; line-height: 1; }
button:disabled { opacity: 0.45; cursor: default; }
</style>
