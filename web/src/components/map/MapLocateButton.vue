<script setup lang="ts">
import Icon from '../ui/Icon.vue';
withDefaults(defineProps<{ label: string; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ press: [] }>();
</script>
<template><button class="locate-button" type="button" :aria-label="label" :disabled="disabled" @click="emit('press')"><Icon :name="disabled ? 'locate-off' : 'locate'" :size="20" /></button></template>
<style scoped>
@import "./map-parts.css";
button { width: 44px; height: 44px; }
.locate-button:disabled { opacity: 1; color: var(--app-text-disabled); cursor: default; }
</style>
