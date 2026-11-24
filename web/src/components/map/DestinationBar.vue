<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from '../ui/Icon.vue';
defineProps<{ placeName: string; remainingM?: number; stopping?: boolean }>();
const emit = defineEmits<{ stop: [] }>();
</script>
<template><div class="destination-bar">
<RouterLink :to="{ name: 'guide' }" :aria-label="`案内を見る、${placeName}まで${remainingM == null ? '' : ` ${Math.round(remainingM)} メートル`}`"><Icon name="navigation" :size="24" filled /><span>{{ placeName }}まで{{ remainingM == null ? '' : ` ${Math.round(remainingM)} m` }}</span></RouterLink>
<button type="button" aria-label="案内をやめる" :disabled="stopping" @click="emit('stop')"><Icon name="close" :size="20" /></button>
</div></template>
<style scoped>
.destination-bar { display: flex; align-items: center; min-height: 52px; padding: 0 6px 0 14px; border-radius: 18px; background: var(--app-destination); color: var(--app-destination-on); font: 700 14px var(--app-font, inherit); }
a { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 52px; flex: 1; color: inherit; text-decoration: none; }
a > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button { display: grid; place-items: center; flex: none; width: 44px; height: 44px; border: 0; border-radius: 14px; background: transparent; color: inherit; cursor: pointer; }
:is(a, button):focus-visible { outline: 2px solid var(--app-destination-on); outline-offset: 2px; }
button:active { background: var(--app-state-pressed); }
</style>
