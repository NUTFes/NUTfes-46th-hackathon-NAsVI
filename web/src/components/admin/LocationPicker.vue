<script setup lang="ts">
import Icon from '../ui/Icon.vue';
export type PickerPoint = { x: number; y: number };
const props = defineProps<{ value?: PickerPoint | null; outlines?: string[]; disabled?: boolean }>();
const emit = defineEmits<{ change: [value: PickerPoint] }>();
const clamp = (n: number) => Math.max(0, Math.min(100, n));
function place(event: MouseEvent) {
  if (props.disabled) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  emit('change', { x: clamp((event.clientX - rect.left) / rect.width * 100), y: clamp((event.clientY - rect.top) / rect.height * 100) });
}
function move(event: KeyboardEvent) {
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], Enter: [0, 0], ' ': [0, 0] };
  const delta = directions[event.key];
  if (!delta || props.disabled) return;
  event.preventDefault();
  emit('change', { x: clamp((props.value?.x ?? 50) + delta[0]), y: clamp((props.value?.y ?? 50) + delta[1]) });
}
</script>

<template>
  <div class="location-picker">
    <span class="label">位置(地図を押して置く)</span>
    <button type="button" class="map" aria-label="位置(地図を押して置く)。矢印キーで移動、Enterで中央に配置" :disabled="disabled" @click="place" @keydown="move">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path v-for="(d, index) in outlines" :key="index" :d="d" /></svg>
      <span v-if="value" class="mark" :style="{ left: `${value.x}%`, top: `${value.y}%` }"><Icon name="flag" :size="14" /></span>
    </button>
    <p aria-live="polite">{{ value ? `横 ${value.x.toFixed(2)}%、縦 ${value.y.toFixed(2)}%（北が上）` : 'まだ置いていません' }}</p>
  </div>
</template>

<style scoped>
.location-picker { color-scheme: dark; display: grid; gap: var(--admin-space-sm); }
.label, p { margin: 0; color: var(--admin-muted); font-size: var(--admin-label-size); }
.map { position: relative; width: 100%; aspect-ratio: 2; min-height: var(--admin-touch-target); padding: 0; border: 1px solid var(--admin-action); border-radius: var(--admin-radius); background: var(--admin-bg); cursor: crosshair; }
.map > svg { display: block; width: 100%; height: 100%; border-radius: inherit; }
path { fill: var(--admin-selected); stroke: var(--admin-action); stroke-width: 1; vector-effect: non-scaling-stroke; }
.mark { position: absolute; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--app-destination); color: var(--app-destination-on); transform: translate(-50%, -50%); pointer-events: none; }
.map:focus-visible { outline: 2px solid var(--admin-action); outline-offset: var(--admin-space-xs); }
.map:disabled { cursor: default; }
</style>
