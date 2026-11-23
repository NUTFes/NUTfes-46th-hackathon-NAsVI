<script setup lang="ts">
import Button, { type ButtonAction } from './Button.vue';
import Icon, { type IconName } from './Icon.vue';

withDefaults(defineProps<{
  title: string;
  body?: string;
  tone?: 'warning' | 'error'; // どちらも赤の枠（danger）。使えない / 失敗
  icon?: IconName; // 既定は alert（警告の三角）
  actions?: ButtonAction[]; // 2 つまで
}>(), { body: undefined, tone: 'warning', icon: 'alert', actions: () => [] });
</script>

<template>
  <section class="nv-banner" :class="`nv-banner--${tone}`" role="alert" :aria-label="title" :data-tone="tone">
    <div class="nv-banner__head">
      <Icon class="nv-banner__icon" :name="icon" :size="22" />
      <div>
        <p class="nv-banner__title">{{ title }}</p>
        <p v-if="body" class="nv-banner__body">{{ body }}</p>
      </div>
    </div>
    <div v-if="actions.length" class="nv-banner__actions">
      <Button
        v-for="(action, index) in actions.slice(0, 2)"
        :key="index"
        :variant="action.variant ?? (index === 0 ? 'danger' : 'secondary')"
        :label="action.label"
        :icon="action.icon"
        :disabled="action.disabled"
        @press="action.onPress?.()"
      />
    </div>
  </section>
</template>

<style scoped>
.nv-banner {
  box-sizing: border-box;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--app-danger-bg); /* danger-bg */
  border: 1px solid var(--app-danger); /* danger */
  border-radius: var(--app-radius-xl, 14px); /* radius.xl */
  color: var(--app-text-primary);
  font-family: var(--app-font, inherit);
}
.nv-banner__head { display: flex; gap: 10px; align-items: flex-start; }
.nv-banner__icon { color: var(--app-danger); margin-top: 1px; }
.nv-banner__title { margin: 0; font-size: 15px; font-weight: 800; line-height: 1.35; }
.nv-banner__body { margin: 4px 0 0; font-size: 12px; line-height: 1.6; color: var(--app-danger-text); } /* danger-text */
.nv-banner__actions { display: flex; gap: var(--app-space-2, 8px); }
.nv-banner__actions > :deep(.nv-btn) { flex: 1; min-width: 0; }
</style>
