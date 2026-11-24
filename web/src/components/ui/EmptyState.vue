<script setup lang="ts">
import Button, { type ButtonAction } from './Button.vue';
import Icon, { type IconName } from './Icon.vue';

withDefaults(defineProps<{
  title: string;
  body?: string;
  icon?: IconName; // 既定は search-off
  actions?: ButtonAction[]; // 3 つまで。先頭が主（既定 primary）、残りは副
}>(), { body: undefined, icon: 'search-off', actions: () => [] });
</script>

<template>
  <section class="nv-empty" :aria-label="title">
    <Icon class="nv-empty__icon" :name="icon" :size="40" />
    <p class="nv-empty__title">{{ title }}</p>
    <p v-if="body" class="nv-empty__body">{{ body }}</p>
    <div v-if="actions.length" class="nv-empty__actions">
      <Button
        v-for="(action, index) in actions.slice(0, 3)"
        :key="index"
        :variant="action.variant ?? (index === 0 ? 'primary' : 'secondary')"
        :label="action.label"
        :icon="action.icon"
        :disabled="action.disabled"
        @press="action.onPress?.()"
      />
    </div>
  </section>
</template>

<style scoped>
.nv-empty {
  box-sizing: border-box;
  padding: 20px 18px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  background: var(--app-bg-surface); /* bg-surface */
  border: 1px solid var(--app-border-subtle); /* border-subtle */
  border-radius: var(--app-radius-xl, 14px); /* radius.xl */
  color: var(--app-text-primary);
  font-family: var(--app-font, inherit);
}
.nv-empty__icon { color: var(--app-text-secondary); }
.nv-empty__title { margin: 0; font-size: 15px; font-weight: 800; line-height: 1.5; }
.nv-empty__body { margin: 0; font-size: 12px; line-height: 1.6; color: var(--app-text-secondary); }
.nv-empty__actions { width: 100%; margin-top: 6px; display: flex; flex-direction: column; gap: var(--app-space-2, 8px); }
.nv-empty__actions > :deep(.nv-btn) { width: 100%; }
</style>
