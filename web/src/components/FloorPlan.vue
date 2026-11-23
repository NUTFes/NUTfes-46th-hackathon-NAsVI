<script lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

// 出典: design-system/tokens.json の color.{dark,light}。建物画面と見取り図で共有する。
const buildingColors = {
  dark: {
    '--building-bg-page': '#130a22',
    '--building-bg-surface': '#1c1032',
    '--building-text-primary': '#f4f0ff',
    '--building-text-secondary': '#b4a9cf',
    '--building-action-primary': '#a78bfa',
    '--building-action-on-primary': '#1e0b3a',
    '--building-border-subtle': 'rgba(167, 139, 250, 0.28)',
    '--building-event': '#5eead4',
    '--building-map-ring': '#130a22',
  },
  light: {
    '--building-bg-page': '#f6f4fa',
    '--building-bg-surface': '#ffffff',
    '--building-text-primary': '#1e0b3a',
    '--building-text-secondary': '#5b5274',
    '--building-action-primary': '#6d28d9',
    '--building-action-on-primary': '#ffffff',
    '--building-border-subtle': 'rgba(30, 11, 58, 0.15)',
    '--building-event': '#0f766e',
    '--building-map-ring': '#f6f4fa',
  },
} as const;
const buildingSizes = {
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

export function useBuildingTokens(element: Ref<Element | undefined>) {
  const theme = ref<'light' | 'dark'>('dark');
  let observer: MutationObserver | undefined;
  function resolveTheme() {
    // M-03 の resolveColors と同じく、最寄りが light のときだけライトにする。
    theme.value = element.value?.closest('[data-theme]')?.getAttribute('data-theme') === 'light'
      ? 'light' : 'dark';
  }
  function observeTheme() {
    observer?.disconnect();
    resolveTheme();
    for (let ancestor = element.value; ancestor; ancestor = ancestor.parentElement ?? undefined) {
      observer?.observe(ancestor, { attributes: true, attributeFilter: ['data-theme'] });
    }
  }
  onMounted(() => {
    observer = new MutationObserver(resolveTheme);
    observeTheme();
  });
  watch(element, observeTheme, { flush: 'post' });
  onBeforeUnmount(() => observer?.disconnect());
  return computed(() => ({ ...buildingSizes, ...buildingColors[theme.value] }));
}
</script>

<script setup lang="ts">
import { floorplanXY } from '../domain/floorplan';
import type { FloorPlan, Place } from '../types';

const props = defineProps<{ plan: FloorPlan | undefined; places: Place[] }>();
const emit = defineEmits<{ select: [id: string] }>();
const root = ref<Element>();
const buildingTokens = useBuildingTokens(root);

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
    ref="root"
    class="floor-plan"
    :style="buildingTokens"
    :viewBox="plan.plan.viewBox"
    overflow="visible"
    role="group"
    :aria-label="description"
  >
    <title>{{ description }}</title>
    <path class="floor-plan__shape" :d="plan.plan.d" />
    <g
      v-for="marker in markers"
      :key="marker.id"
      class="floor-plan__marker-group"
    >
      <circle
        class="floor-plan__marker"
        :cx="marker.x"
        :cy="marker.y"
        :r="parseFloat(buildingTokens['--building-space-3'])"
        aria-hidden="true"
        pointer-events="none"
      />
      <!-- 非拡縮の透明な線で、viewBox の縮小後も直径44 CSS px以上を確保する。 -->
      <circle
        class="floor-plan__target"
        :cx="marker.x"
        :cy="marker.y"
        :r="parseFloat(buildingTokens['--building-space-3'])"
        fill="transparent"
        stroke="transparent"
        :stroke-width="parseFloat(buildingTokens['--building-touch-target'])"
        vector-effect="non-scaling-stroke"
        pointer-events="all"
        role="button"
        tabindex="0"
        :aria-label="marker.name"
        @click="emit('select', marker.id)"
        @keydown.enter.prevent="emit('select', marker.id)"
        @keydown.space.prevent="emit('select', marker.id)"
      />
    </g>
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
}

.floor-plan__target {
  cursor: pointer;
}

.floor-plan__target:focus-visible {
  outline: none;
}

.floor-plan__marker-group:focus-within .floor-plan__marker {
  stroke: var(--building-action-primary);
}
</style>
