<script lang="ts">
// design-system/tokens.json のダーク配色。建物画面と見取り図の値をここに集約する。
export const buildingTokens = {
  '--building-bg-page': '#130a22', // bg-page
  '--building-bg-surface': '#1c1032', // bg-surface
  '--building-text-primary': '#f4f0ff', // text-primary
  '--building-text-secondary': '#b4a9cf', // text-secondary
  '--building-action-primary': '#a78bfa', // action-primary
  '--building-action-on-primary': '#1e0b3a', // action-on-primary
  '--building-border-subtle': 'rgba(167, 139, 250, 0.28)', // border-subtle
  '--building-event': '#5eead4', // event
  '--building-map-ring': '#130a22', // map-ring
  '--building-space-1': '4px', // space-1
  '--building-space-2': '8px', // space-2
  '--building-space-3': '12px', // space-3
  '--building-space-4': '16px', // space-4
  '--building-font-md': '14px', // font.size.md
  '--building-font-xl': '16px', // font.size.xl
  '--building-font-2xl': '20px', // font.size.2xl
  '--building-radius': '10px', // radius.md
  '--building-touch-target': '44px', // size.touch-target=44px
} as const;
</script>

<script setup lang="ts">
import { computed } from 'vue';
import { floorplanXY } from '../domain/floorplan';
import type { FloorPlan, Place } from '../types';

const props = defineProps<{ plan: FloorPlan | undefined; places: Place[] }>();
const emit = defineEmits<{ select: [id: string] }>();

const description = computed(() => {
  const floor = props.plan?.floor;
  const label = floor !== undefined && floor < 0 ? `地下${Math.abs(floor)}階` : `${floor}階`;
  return `${label}の見取り図。円は企画の位置です`;
});
const markers = computed(() => {
  const plan = props.plan;
  if (!plan) return [];
  return props.places.filter((place) => place.kind === 'event').map((place) => ({
    id: place.id,
    name: place.name,
    ...floorplanXY(place.location, plan.bounds, plan.plan.viewBox),
  }));
});
</script>

<template>
  <svg
    v-if="plan"
    class="floor-plan"
    :style="buildingTokens"
    :viewBox="plan.plan.viewBox"
    role="group"
    :aria-label="description"
  >
    <title>{{ description }}</title>
    <path class="floor-plan__shape" :d="plan.plan.d" />
    <circle
      v-for="marker in markers"
      :key="marker.id"
      class="floor-plan__marker"
      :cx="marker.x"
      :cy="marker.y"
      :r="parseFloat(buildingTokens['--building-space-3'])"
      role="button"
      tabindex="0"
      :aria-label="marker.name"
      @click="emit('select', marker.id)"
      @keydown.enter.prevent="emit('select', marker.id)"
      @keydown.space.prevent="emit('select', marker.id)"
    />
  </svg>
</template>

<style scoped>
.floor-plan {
  display: block;
  width: 100%;
  background: var(--building-bg-page);
  border-radius: var(--building-radius);
}

.floor-plan__shape {
  fill: var(--building-bg-surface);
  stroke: var(--building-border-subtle);
  stroke-width: var(--building-space-1);
  vector-effect: non-scaling-stroke;
}

.floor-plan__marker {
  fill: var(--building-event);
  stroke: var(--building-map-ring);
  stroke-width: var(--building-space-1);
  vector-effect: non-scaling-stroke;
  cursor: pointer;
}

.floor-plan__marker:focus-visible {
  outline: none;
  stroke: var(--building-action-primary);
}
</style>
