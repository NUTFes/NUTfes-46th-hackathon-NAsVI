<script lang="ts">
// 出典: design-system/claude-design/components/bundle.js の Icon（Figma の Icon ページ 22:189 と同じ 29 種。
// Figma の説明に「出典: claude-design/components/bundle.js の Icon」とある）。24 の格子、線で描く。
type Shape = { tag: 'path' | 'circle'; attrs: Record<string, string | number> };
type Spec = { sw: number; fillable?: boolean; filled?: boolean; shapes: Shape[] };
const path = (d: string): Shape => ({ tag: 'path', attrs: { d } });
const circle = (cx: number, cy: number, r: number, extra: Record<string, string> = {}): Shape =>
  ({ tag: 'circle', attrs: { cx, cy, r, ...extra } });
const dot = (cy: number) => circle(4.5, cy, 1, { fill: 'currentColor' });

const ICONS = {
  search: { sw: 2, shapes: [circle(11, 11, 7), path('m20 20-3.5-3.5')] },
  'search-off': { sw: 1.6, shapes: [circle(11, 11, 7), path('m20 20-3.5-3.5M8.5 8.5l5 5M13.5 8.5l-5 5')] },
  close: { sw: 2, shapes: [path('M6 6l12 12M18 6 6 18')] },
  locate: { sw: 2, shapes: [path('M20 4 4 11l7 2 2 7z')] },
  'locate-off': { sw: 2, shapes: [path('M20 4 4 11l7 2 2 7z'), path('M3 3l18 18')] },
  'zoom-in': { sw: 2.4, shapes: [path('M12 5v14M5 12h14')] },
  'zoom-out': { sw: 2.4, shapes: [path('M5 12h14')] },
  plus: { sw: 2.4, shapes: [path('M12 5v14M5 12h14')] },
  layers: { sw: 2, shapes: [path('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z'), circle(12, 12, 3)] },
  stamp: { sw: 2.2, shapes: [path('M9 4h6v6l3 3v2H6v-2l3-3z'), path('M5 20h14')] },
  list: { sw: 1.9, shapes: [path('M9 6h11M9 12h11M9 18h11'), dot(6), dot(12), dot(18)] },
  map: { sw: 1.9, shapes: [path('M12 3 21 8l-9 5-9-5z'), path('m3 12 9 5 9-5M3 16l9 5 9-5')] },
  camera: {
    sw: 1.9,
    shapes: [
      path('M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2'),
      circle(12, 12, 3),
    ],
  },
  filter: { sw: 2, shapes: [path('M4 5h16l-6 7v6l-4 2v-8z')] },
  star: { sw: 2, fillable: true, shapes: [path('m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z')] },
  bookmark: { sw: 2, fillable: true, shapes: [path('M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z')] },
  tag: {
    sw: 1.9,
    shapes: [path('M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z'), circle(8, 8, 1.3, { fill: 'currentColor', stroke: 'none' })],
  },
  check: { sw: 2.6, shapes: [path('m5 12 5 5 9-10')] },
  'chevron-right': { sw: 2.4, shapes: [path('M9 5l7 7-7 7')] },
  navigation: { sw: 2.4, fillable: true, shapes: [path('M12 2 21 21 12 16.5 3 21Z')] },
  flag: { sw: 3, shapes: [path('M6 21V4M6 4h11l-2.5 4L17 12H6')] },
  info: { sw: 2.2, shapes: [path('M12 2.8a9.2 9.2 0 1 0 0 18.4a9.2 9.2 0 1 0 0-18.4zM12 10.8v6M12 7.3v.3')] },
  wc: {
    sw: 0.4,
    filled: true,
    shapes: [path('M7 2.2a2 2 0 1 1 0 4a2 2 0 1 1 0-4zM5.6 7.2h2.8a1.2 1.2 0 0 1 1.2 1.2V14H4.4V8.4a1.2 1.2 0 0 1 1.2-1.2zM4.9 14h1.8v7H4.9zM7.3 14h1.8v7H7.3zM17 2.2a2 2 0 1 1 0 4a2 2 0 1 1 0-4zM15.8 7.2h2.4l2.9 8.2h-8.2zM15.2 15.4h1.6V21h-1.6zM17.2 15.4h1.6V21h-1.6zM11.55 3h0.9v18h-0.9z')],
  },
  rest: { sw: 2.2, shapes: [path('M5 7h14M4 12h16M7 7v5M17 7v5M6 12v6M18 12v6')] },
  trash: { sw: 2.2, shapes: [path('M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12')] },
  fun: { sw: 2.6, shapes: [path('M8 14c1 2 2.4 3 4 3s3-1 4-3M9 9v.5M15 9v.5')] },
  food: { sw: 2, shapes: [path('M7 3v5a2 2 0 0 0 4 0V3M9 3v18M17 3c-1.7 0-3 2-3 4.5S15.3 12 17 12s3-2 3-4.5S18.7 3 17 3zM17 12v9')] },
  good: { sw: 1.9, shapes: [path('M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.5 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7')] },
  alert: { sw: 2.2, shapes: [path('M12 3 22 20H2z'), path('M12 10v4M12 17v.3')] },
} satisfies Record<string, Spec>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];
</script>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  name: IconName;
  size?: number; // px
  filled?: boolean; // star・bookmark・navigation だけ塗りつぶす
  strokeWidth?: number;
  rotate?: number; // 度。行き先の矢印に使う
  label?: string; // 渡すと読み上げる（role="img"）。無ければ飾り（aria-hidden）
}>(), { size: 20, filled: false, strokeWidth: undefined, rotate: 0, label: undefined });

const spec = computed<Spec | undefined>(() => (ICONS as Record<string, Spec>)[props.name]);
const solid = computed(() => Boolean(spec.value?.filled || (props.filled && spec.value?.fillable)));
const shapes = computed(() => (spec.value?.shapes ?? []).map(shape =>
  solid.value && shape.tag === 'path' && !('fill' in shape.attrs)
    ? { ...shape, attrs: { ...shape.attrs, fill: 'currentColor' } } : shape));
</script>

<template>
  <svg
    v-if="spec"
    class="nv-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth ?? spec.sw"
    stroke-linecap="round"
    stroke-linejoin="round"
    :style="rotate ? { transform: `rotate(${rotate}deg)` } : undefined"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
    :data-icon="name"
    :data-filled="solid ? 'true' : undefined"
    focusable="false"
  >
    <component :is="shape.tag" v-for="(shape, index) in shapes" :key="index" v-bind="shape.attrs" />
  </svg>
</template>

<style scoped>
.nv-icon { display: block; flex: none; } /* 色は currentColor（親の color を引き継ぐ） */
</style>
