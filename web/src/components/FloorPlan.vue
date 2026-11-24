<script setup lang="ts">
import { computed, ref } from 'vue';
import { floorplanXY } from '../domain/floorplan';
import type { FloorPlan, Place } from '../types';
import Icon from './ui/Icon.vue';

// 色は I-0 の --app-*（親の画面が useAppTokens で与える）。BuildingFloorPlan・FacilityMark の Figma に合わせる。
const props = defineProps<{ plan: FloorPlan | undefined; places: Place[]; facilities?: Place[] }>();
const emit = defineEmits<{ select: [id: string] }>();

const MARKER_RADIUS = 12; // space.3
const TOUCH_TARGET = 44; // size.touch-target
const FACILITY_ICONS = { info: 'info', wc: 'wc', rest: 'rest', trash: 'trash' } as const;

const floorLabel = computed(() => {
  const floor = props.plan?.floor;
  return floor !== undefined && floor < 0 ? `地下${Math.abs(floor)}階` : `${floor}階`;
});
const description = computed(() => `${floorLabel.value}の見取り図。円は企画の位置、白い丸は設備の位置です`);
const box = computed(() => {
  const [x, y, width, height] = (props.plan?.plan.viewBox ?? '0 0 1 1').trim().split(/[\s,]+/).map(Number);
  return { x, y, width, height };
});
function position(place: Place) {
  const plan = props.plan!;
  const point = floorplanXY(place.location, plan.bounds, plan.plan.viewBox);
  return {
    ...point,
    left: `${(point.x - box.value.x) / box.value.width * 100}%`,
    top: `${(point.y - box.value.y) / box.value.height * 100}%`,
  };
}
const markers = computed(() => props.plan
  ? props.places.filter((place) => place.kind === 'event').map((place) => ({
    id: place.id, name: place.name, ...position(place),
  }))
  : []);
const facilityMarks = computed(() => props.plan
  ? (props.facilities ?? [])
    .filter((place): place is Place & { kind: keyof typeof FACILITY_ICONS } => place.kind in FACILITY_ICONS)
    .map((place) => ({ id: place.id, name: place.name, icon: FACILITY_ICONS[place.kind], ...position(place) }))
  : []);

// 吹き出しは、指・マウス・キーボードが乗っている企画の名前を出す。
const active = ref<string>();
const bubble = computed(() => markers.value.find((marker) => marker.id === active.value));
</script>

<template>
  <div v-if="plan" class="floor-plan">
    <svg
      class="floor-plan__svg"
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
          :r="MARKER_RADIUS"
          aria-hidden="true"
          pointer-events="none"
        />
        <!-- 非拡縮の透明な線で、viewBox の縮小後も直径44 CSS px以上を確保する。 -->
        <circle
          class="floor-plan__target"
          :cx="marker.x"
          :cy="marker.y"
          :r="MARKER_RADIUS"
          fill="transparent"
          stroke="transparent"
          :stroke-width="TOUCH_TARGET"
          vector-effect="non-scaling-stroke"
          pointer-events="all"
          role="button"
          tabindex="0"
          :aria-label="marker.name"
          @click="emit('select', marker.id)"
          @keydown.enter.prevent="emit('select', marker.id)"
          @keydown.space.prevent="emit('select', marker.id)"
          @pointerenter="active = marker.id"
          @pointerleave="active = undefined"
          @focus="active = marker.id"
          @blur="active = undefined"
        />
      </g>
    </svg>
    <span
      v-for="mark in facilityMarks"
      :key="mark.id"
      class="floor-plan__facility"
      role="img"
      :aria-label="mark.name"
      :style="{ left: mark.left, top: mark.top }"
    >
      <Icon :name="mark.icon" :size="16" />
    </span>
    <!-- 名前は印の aria-label で読み上げるので、吹き出しは飾り。 -->
    <span
      v-if="bubble"
      class="floor-plan__bubble"
      aria-hidden="true"
      :style="{ left: `${(bubble.x - box.x) / box.width * 100}%`, top: `${(bubble.y - box.y) / box.height * 100}%` }"
    >
      <span class="floor-plan__label">{{ bubble.name }}</span>
      <span class="floor-plan__stem" />
    </span>
    <span class="floor-plan__note">{{ floorLabel }}・見取り図は仮</span>
  </div>
</template>

<style scoped>
.floor-plan {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--app-radius);
  background: var(--app-bg-page);
  font-family: var(--app-font);
}

.floor-plan__svg {
  display: block;
  width: 100%;
  padding: 0;
}

.floor-plan__shape {
  fill: color-mix(in srgb, var(--app-event) 28%, var(--app-bg-page));
  stroke: var(--app-event);
  stroke-width: 1.5px;
  vector-effect: non-scaling-stroke;
}

.floor-plan__marker {
  fill: var(--app-event);
  stroke: var(--app-map-ring);
  stroke-width: var(--app-space-1);
  vector-effect: non-scaling-stroke;
}

.floor-plan__target {
  cursor: pointer;
}

.floor-plan__target:focus-visible {
  outline: none;
}

.floor-plan__marker-group:focus-within .floor-plan__marker {
  stroke: var(--app-action-primary);
}

/* FacilityMark（zoomed）: 26px の白い丸にアイコン。 */
.floor-plan__facility {
  position: absolute;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--app-facility);
  color: var(--app-facility-on);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* 吹き出し: 点の真上に、名前の札と柱を置く。 */
.floor-plan__bubble {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translate(-50%, calc(-100% - 6px));
  pointer-events: none;
}

.floor-plan__label {
  padding: var(--app-space-1) 10px;
  border-radius: var(--app-radius-sm, 8px);
  background: var(--app-facility);
  color: var(--app-facility-on);
  font-size: 12px;
  font-weight: var(--app-bold);
  line-height: 1;
  white-space: nowrap;
}

.floor-plan__stem {
  width: 2px;
  height: 10px;
  background: var(--app-facility);
}

.floor-plan__note {
  position: absolute;
  top: 5px;
  right: 8px;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--app-bg-surface);
  color: var(--app-text-secondary);
  font-size: 10px;
  line-height: 1.4;
  white-space: nowrap;
}
</style>
