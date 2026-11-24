<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from './Icon.vue';

defineProps<{
  items: readonly { name: 'list' | 'map' | 'camera'; label: string }[];
  current: string;
}>();
</script>

<template>
  <nav class="visitor-tabs" aria-label="表示を切り替える">
    <RouterLink v-for="item in items" :key="item.name" :to="{ name: item.name }"
      :aria-current="current === item.name ? 'page' : undefined">
      <Icon :name="item.name" :size="24" aria-hidden="true" />
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.visitor-tabs {
  position: relative; z-index: 1;
  display: flex; flex: none; background: var(--app-bg-surface);
  padding-bottom: env(safe-area-inset-bottom);
}
.visitor-tabs a {
  box-sizing: border-box; display: flex; flex: 1; flex-direction: column;
  align-items: center; justify-content: center; gap: var(--app-space-1);
  height: var(--app-tab-height); min-height: var(--app-touch); min-width: var(--app-touch);
  border: 0; border-radius: 0; background: var(--app-bg-surface);
  color: var(--app-text-secondary); font: inherit; font-size: 10px;
  text-decoration: none; cursor: pointer;
}
.visitor-tabs a[aria-current="page"] { color: var(--app-text-primary); font-weight: var(--app-bold); }
.visitor-tabs a[aria-current="page"] .nv-icon { color: var(--app-event); }
.visitor-tabs a:focus-visible { outline: solid var(--app-action-primary); outline-offset: var(--app-space-1); }
</style>
