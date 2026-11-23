<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import ArView from '../ar/ArView.vue';
import { getStorage } from '../storage';
import { useLandmarksStore, usePlacesStore } from '../stores';
import type { Destination } from '../types';

const places = usePlacesStore();
const landmarks = useLandmarksStore();
const router = useRouter();
const destination = ref<Destination | null>(null);
let disposed = false;
onMounted(async () => {
  try {
    const saved = await (await getStorage()).destination.get();
    if (!disposed) destination.value = saved;
  } catch { /* 保存を読めなくてもカメラの表示を続ける。 */ }
});
onBeforeUnmount(() => { disposed = true; });
async function stopGuide() {
  destination.value = null;
  try { await (await getStorage()).destination.clear(); }
  catch { /* この画面の案内は端末内で止めたままにする。 */ }
}
</script>

<template>
  <ArView
    :places="places.items"
    :landmarks="landmarks.items"
    :destination="destination"
    @select="id => router.push({ name: 'card', params: { id } })"
    @building="id => router.push({ name: 'building', params: { id } })"
    @stop="stopGuide"
  >
    <nav aria-label="表示を切り替える">
      <RouterLink :to="{ name: 'map' }">地図</RouterLink>
      <RouterLink :to="{ name: 'list' }">企画一覧</RouterLink>
    </nav>
    <template #fallback><RouterLink :to="{ name: 'map' }">地図に戻る</RouterLink></template>
  </ArView>
</template>
