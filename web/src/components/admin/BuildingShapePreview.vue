<script setup lang="ts">
import Button from '../ui/Button.vue';
defineProps<{ shape: { viewBox: string; d: string } | null; disabled?: boolean; label?: string }>();
const emit = defineEmits<{ reload: [] }>();
</script>

<template>
  <div class="building-shape-preview">
    <div class="frame">
      <svg v-if="shape" :viewBox="shape.viewBox" role="img" :aria-label="label ?? '建物の形（北が上）'"><path :d="shape.d" /></svg>
      <p v-else class="missing">形なし（カメラの正面に出ない）</p>
    </div>
    <Button variant="secondary" label="形を読み込み直す" :disabled="disabled" @press="emit('reload')" />
    <p class="attribution">© OpenStreetMap contributors（ODbL）</p>
  </div>
</template>

<style scoped>
.building-shape-preview { color-scheme: dark; display: grid; justify-items: start; gap: var(--admin-space-sm); }
.frame { display: grid; place-items: center; box-sizing: border-box; width: 100%; aspect-ratio: 18 / 7; padding: var(--admin-space-lg); border: 1px solid var(--admin-border); border-radius: var(--admin-radius); background: var(--admin-bg); }
svg { width: 100%; height: 100%; min-height: 0; max-height: 240px; }
path { fill: var(--admin-selected); stroke: var(--app-event); stroke-width: 2; vector-effect: non-scaling-stroke; }
p { margin: 0; font-size: var(--admin-label-size); }
.missing { color: var(--admin-danger-text); font-weight: var(--admin-bold); }
.attribution { color: var(--admin-muted); }
</style>
