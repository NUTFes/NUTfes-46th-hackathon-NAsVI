<script setup lang="ts">
import Icon from '../ui/Icon.vue';
withDefaults(defineProps<{ label?: string }>(), { label: '表示する印を選ぶ' });
const emit = defineEmits<{ press: [] }>();
</script>
<template><button type="button" :aria-label="label" aria-haspopup="dialog" @click="emit('press')"><Icon name="layers" :size="20" /><span>表示</span></button></template>
<style scoped>
@import "./map-parts.css";
button { width: 44px; height: 50px; flex-direction: column; gap: 2px; font-size: 11px; font-weight: 700; line-height: 1; }
</style>
