<script setup lang="ts">
import Icon from '../ui/Icon.vue';
export type PickerPoint = { x: number; y: number };
const props = defineProps<{ value?: PickerPoint | null; outlines?: string[]; disabled?: boolean; outOfRange?: boolean }>();
const emit = defineEmits<{ change: [value: PickerPoint] }>();
const clamp = (n: number) => Math.max(0, Math.min(100, n));
function place(event: MouseEvent) {
  if (props.disabled || event.detail === 0) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  emit('change', { x: clamp((event.clientX - rect.left) / rect.width * 100), y: clamp((event.clientY - rect.top) / rect.height * 100) });
}
function move(event: KeyboardEvent) {
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], Enter: [0, 0], ' ': [0, 0] };
  const delta = directions[event.key];
  if (!delta || props.disabled) return;
  event.preventDefault();
  const activate = event.key === 'Enter' || event.key === ' ';
  if (props.outOfRange && !activate) return;
  const value = props.outOfRange ? null : props.value;
  const step = event.shiftKey ? 5 : 1;
  emit('change', { x: clamp((value?.x ?? 50) + delta[0] * step), y: clamp((value?.y ?? 50) + delta[1] * step) });
}
</script>

<template>
  <div class="location-picker">
    <span class="label">位置(地図を押して置く)</span>
    <button type="button" class="map" aria-label="位置(地図を押して置く)。矢印キーで1%、Shift併用で5%移動。EnterまたはSpaceで配置" :disabled="disabled" @click="place" @keydown="move">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path v-for="(d, index) in outlines" :key="index" :d="d" /></svg>
      <span v-if="value && !outOfRange" class="mark" :style="{ left: `${value.x}%`, top: `${value.y}%` }"><Icon name="flag" :size="14" /></span>
    </button>
    <p aria-live="polite">{{ outOfRange ? '入力した座標は地図の範囲外です。地図を押すか、EnterまたはSpaceで中央に置き直せます。' : value ? `横 ${value.x.toFixed(2)}%、縦 ${value.y.toFixed(2)}%（北が上）` : 'まだ置いていません' }}</p>
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
