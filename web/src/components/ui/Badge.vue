<script setup lang="ts">
withDefaults(defineProps<{
  label: string;
  tone?: 'neutral' | 'parking' | 'ok' | 'warn';
}>(), { tone: 'neutral' });
</script>

<template>
  <span class="nv-badge" :class="tone !== 'neutral' && `nv-badge--${tone}`" :data-tone="tone">{{ label }}</span>
</template>

<style scoped>
.nv-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--app-radius-sm, 8px); /* radius.sm */
  font-family: var(--app-font, inherit);
  font-size: 12px;
  font-weight: var(--app-bold, 700);
  white-space: nowrap;
  /* neutral: action-selected-bg / text-primary */
  background: var(--app-action-selected-bg, var(--action-selected-bg));
  color: var(--app-text-primary);
}
.nv-badge--parking { background: var(--app-parking, var(--parking)); color: var(--app-parking-on, var(--parking-on)); } /* parking / parking-on */
.nv-badge--ok { background: var(--app-event); color: var(--app-event-on, var(--event-on)); } /* event / event-on */
.nv-badge--warn { background: var(--app-danger-bg); color: var(--app-danger-text); box-shadow: inset 0 0 0 1px var(--app-danger); } /* danger-bg / danger-text / danger */
</style>
