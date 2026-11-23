<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FloorPlan, { buildingTokens } from '../components/FloorPlan.vue';
import { useLandmarksStore, usePlacesStore } from '../stores';

const route = useRoute();
const router = useRouter();
const places = usePlacesStore();
const landmarks = useLandmarksStore();
const buildingId = computed(() => String(route.params.id ?? ''));
const building = computed(() => landmarks.items.find((item) => item.id === buildingId.value));
const events = computed(() => places.items.filter((place) =>
  place.landmarkId === buildingId.value && place.kind === 'event',
));
const floors = computed(() => {
  const numbers = new Set(building.value?.floors.map((plan) => plan.floor) ?? []);
  for (const place of events.value) {
    numbers.add(place.floor ?? 1);
  }
  return [...numbers].sort((a, b) => a - b).map((floor) => ({
    floor,
    count: events.value.filter((place) => (place.floor ?? 1) === floor).length,
  }));
});
const selection = ref<{ buildingId: string; floor: number }>();
const currentFloor = computed(() => {
  if (selection.value?.buildingId === buildingId.value
    && floors.value.some((item) => item.floor === selection.value?.floor)) {
    return selection.value.floor;
  }
  return floors.value.find((item) => item.floor === 1)?.floor ?? floors.value[0]?.floor;
});
const plan = computed(() => building.value?.floors.find((item) => item.floor === currentFloor.value));
const currentPlaces = computed(() => events.value.filter((place) => (place.floor ?? 1) === currentFloor.value));
const otherFloors = computed(() => floors.value.filter((item) => item.count > 0 && item.floor !== currentFloor.value));

function floorLabel(floor: number) {
  return floor < 0 ? `地下${Math.abs(floor)}階` : `${floor}階`;
}
function selectFloor(floor: number) {
  selection.value = { buildingId: buildingId.value, floor };
}
function openPlace(id: string) {
  void router.push({ name: 'card', params: { id } });
}
</script>

<template>
  <main class="building" :style="buildingTokens">
    <template v-if="building">
      <h1>{{ building.name }}</h1>
      <nav class="building__floors" aria-label="階">
        <button
          v-for="item in floors"
          :key="item.floor"
          type="button"
          :aria-pressed="item.floor === currentFloor"
          :aria-label="`${floorLabel(item.floor)}、企画 ${item.count} 件`"
          @click="selectFloor(item.floor)"
        >
          {{ floorLabel(item.floor) }}
          <span v-if="item.count > 0">{{ item.count }} 件</span>
        </button>
      </nav>

      <FloorPlan :plan="plan" :places="currentPlaces" @select="openPlace" />
      <p v-if="!plan" class="building__note">この階の見取り図はありません</p>

      <section class="building__events" aria-label="この階の企画">
        <h2 v-if="currentFloor !== undefined">{{ floorLabel(currentFloor) }}の企画 {{ currentPlaces.length }} 件</h2>
        <div v-if="currentPlaces.length === 0" class="building__empty">
          <h2>{{ events.length === 0 ? 'この建物には企画がありません' : 'この階に企画はありません' }}</h2>
          <p v-if="otherFloors.length">企画のある階を選んでください。</p>
          <div v-if="otherFloors.length" class="building__suggestions">
            <button
              v-for="item in otherFloors"
              :key="item.floor"
              type="button"
              @click="selectFloor(item.floor)"
            >
              {{ floorLabel(item.floor) }}の企画を見る（{{ item.count }} 件）
            </button>
          </div>
        </div>
        <ul v-else class="building__list">
          <li v-for="place in currentPlaces" :key="place.id">
            <button type="button" class="building__row" @click="openPlace(place.id)">
              <span class="building__name">{{ place.name }}</span>
              <span class="building__note">企画 · {{ building.name }} · {{ floorLabel(currentFloor!) }}</span>
            </button>
          </li>
        </ul>
      </section>
    </template>
    <!-- ストアは未取得と該当なしを区別できないため、建物を参照できるまで空にする。 -->
  </main>
</template>

<style scoped>
.building {
  box-sizing: border-box;
  min-height: 100%;
  padding: var(--building-space-4);
  background: var(--building-bg-page);
  color: var(--building-text-primary);
  font-size: var(--building-font-md);
}

h1 {
  margin: 0 0 var(--building-space-4);
  font-size: var(--building-font-2xl);
}

h2 {
  margin: 0;
  font-size: var(--building-font-xl);
}

.building__floors,
.building__suggestions {
  display: flex;
  gap: var(--building-space-2);
}

.building__floors {
  margin-bottom: var(--building-space-4);
  overflow-x: auto;
  padding: var(--building-space-1);
}

button {
  box-sizing: border-box;
  min-height: var(--building-touch-target);
  padding: var(--building-space-2) var(--building-space-3);
  border: 1px solid var(--building-border-subtle);
  border-radius: var(--building-radius);
  background: var(--building-bg-surface);
  color: var(--building-text-primary);
  font: inherit;
  cursor: pointer;
}

.building__floors button {
  display: flex;
  align-items: center;
  gap: var(--building-space-2);
  height: var(--building-touch-target);
  flex-shrink: 0;
}

button[aria-pressed='true'],
.building__suggestions button {
  background: var(--building-action-primary);
  color: var(--building-action-on-primary);
}

button:focus-visible {
  outline: var(--building-space-1) solid var(--building-action-primary);
}

.building__events {
  display: grid;
  gap: var(--building-space-3);
  margin-top: var(--building-space-4);
}

.building__empty {
  padding: var(--building-space-4);
  border-radius: var(--building-radius);
  background: var(--building-bg-surface);
}

.building__empty p {
  margin: var(--building-space-3) 0;
}

.building__note,
.building__empty p {
  color: var(--building-text-secondary);
}

.building__suggestions {
  flex-wrap: wrap;
}

.building__list {
  display: grid;
  gap: var(--building-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.building__row {
  display: grid;
  gap: var(--building-space-2);
  width: 100%;
  min-height: calc(var(--building-touch-target) + var(--building-space-3));
  padding: var(--building-space-3);
  text-align: start;
}

.building__name {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
}
</style>
