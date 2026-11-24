<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { project, stepView, type View } from './core';
import { createInteraction, resetNorth, zoomAt, K_MIN, K_MAX, TH0, type PointerInput } from './interaction';
import { toXY } from '../domain/geo';
import { layers } from './layers';
import type { Layer, MapState } from './layers/types';

const props = defineProps<{ state: MapState }>();
const emit = defineEmits<{
  zoomLimits: [limits: { zoomInDisabled: boolean; zoomOutDisabled: boolean }];
  tap: [x: number, y: number];
  select: [selection: NonNullable<ReturnType<NonNullable<Layer['hitTest']>>>];
}>();
const canvas = ref<HTMLCanvasElement | null>(null);
const needle = ref<SVGSVGElement | null>(null);
// 地図単体では画面中央を使う。画面固有のヘッダー・カードの寸法には依存しない。
const view: View = { fx: 0, fy: 0, k: 1, th: TH0, cy: 0 };
const goal = reactive({ ...view });
const zoomInDisabled = computed(() => goal.k >= K_MAX);
const zoomOutDisabled = computed(() => goal.k <= K_MIN);
watch([zoomInDisabled, zoomOutDisabled], ([zoomInDisabled, zoomOutDisabled]) => {
  emit('zoomLimits', { zoomInDisabled, zoomOutDisabled });
}, { immediate: true });
function zoomBy(direction: number) {
  zoomAt(goal, W / 2, H / 2, W, H, 1.25 ** direction);
}
function flyTo() {
  if (!props.state.position) return;
  const [x, y] = toXY(props.state.position.lat, props.state.position.lng);
  goal.fx = x;
  goal.fy = y;
}
defineExpose({ zoomBy, flyTo, zoomInDisabled, zoomOutDisabled });
let W = 0;
let H = 0;
let dispose = () => {};

onMounted(() => {
  const cv = canvas.value!;
  const context = cv.getContext('2d');
  if (!context) return;
  const ctx = context;
  let dpr = 1;
  let initialized = false;
  let inViewport = true;
  let disposed = false;
  let frame: number | null = null;
  const captured = new Set<number>();
  const interaction = createInteraction({
    view, goal, getSize: () => ({ width: W, height: H }),
    onTap(x, y) {
      emit('tap', x, y);
      for (let i = layers.length - 1; i >= 0; i--) {
        const selection = layers[i].hitTest?.(x, y);
        if (selection) { emit('select', selection); break; }
      }
    },
  });
  const visible = () => !disposed && !document.hidden && inViewport && W > 0 && H > 0;

  function draw(t: number) {
    frame = null;
    if (!visible()) return;
    Object.assign(view, stepView(view, goal));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const layer of layers) {
      ctx.save();
      try { layer.draw(ctx, view, props.state, t); }
      finally { ctx.restore(); }
    }
    const [x0, y0] = project(view, W, H, view.fx, view.fy);
    const [x1, y1] = project(view, W, H, view.fx, view.fy + 10);
    if (needle.value) needle.value.style.transform = `rotate(${Math.atan2(x1 - x0, -(y1 - y0))}rad)`;
    schedule();
  }

  function schedule() {
    if (visible() && frame === null) frame = requestAnimationFrame(draw);
    else if (!visible() && frame !== null) { cancelAnimationFrame(frame); frame = null; }
  }

  function resize(width: number, height: number) {
    W = width;
    H = height;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.round(W * dpr);
    const pixelHeight = Math.round(H * dpr);
    if (cv.width !== pixelWidth) cv.width = pixelWidth;
    if (cv.height !== pixelHeight) cv.height = pixelHeight;
    if (W > 0 && H > 0) {
      if (!initialized) {
        view.k = goal.k = Math.max(K_MIN, Math.min(K_MAX, W / 240));
        view.cy = goal.cy = H / 2;
        initialized = true;
      } else goal.cy = H / 2;
    }
    schedule();
  }

  function measure() {
    const rect = cv.getBoundingClientRect();
    resize(rect.width, rect.height);
  }
  const local = (e: PointerEvent | WheelEvent) => {
    const rect = cv.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const input = (e: PointerEvent): PointerInput => ({
    ...local(e), pointerId: e.pointerId, button: e.button, shiftKey: e.shiftKey,
  });
  const release = (id: number) => {
    captured.delete(id);
    if (cv.hasPointerCapture(id)) cv.releasePointerCapture(id);
  };
  const cancelInteraction = () => {
    interaction.cancel();
    for (const id of captured) release(id);
  };
  const down = (e: PointerEvent) => {
    if (!visible() || (e.button !== 0 && e.button !== 2)) return;
    cv.setPointerCapture(e.pointerId);
    captured.add(e.pointerId);
    interaction.pointerDown(input(e));
  };
  const move = (e: PointerEvent) => interaction.pointerMove(input(e));
  const up = (e: PointerEvent) => { interaction.pointerUp(input(e)); release(e.pointerId); };
  const cancel = (e: PointerEvent) => { interaction.pointerCancel(input(e)); release(e.pointerId); };
  const lostCapture = (e: PointerEvent) => {
    captured.delete(e.pointerId);
    interaction.pointerCancel(input(e));
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!visible()) return;
    const { x, y } = local(e);
    interaction.wheel(x, y, e.deltaY);
  };
  const contextmenu = (e: Event) => e.preventDefault();
  const visibility = () => {
    if (document.hidden) cancelInteraction();
    else measure();
    schedule();
  };
  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries.find((entry) => entry.target === cv);
    if (entry) resize(entry.contentRect.width, entry.contentRect.height);
  });
  const intersectionObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    const entry = entries.find((entry) => entry.target === cv);
    if (!entry) return;
    inViewport = entry.isIntersecting;
    if (!inViewport) cancelInteraction();
    schedule();
  });
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', cancel);
  cv.addEventListener('lostpointercapture', lostCapture);
  cv.addEventListener('wheel', wheel, { passive: false });
  cv.addEventListener('contextmenu', contextmenu);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('resize', measure);
  resizeObserver.observe(cv);
  intersectionObserver?.observe(cv);
  measure();

  dispose = () => {
    disposed = true;
    schedule();
    resizeObserver.disconnect();
    intersectionObserver?.disconnect();
    cancelInteraction();
    cv.removeEventListener('pointerdown', down);
    cv.removeEventListener('pointermove', move);
    cv.removeEventListener('pointerup', up);
    cv.removeEventListener('pointercancel', cancel);
    cv.removeEventListener('lostpointercapture', lostCapture);
    cv.removeEventListener('wheel', wheel);
    cv.removeEventListener('contextmenu', contextmenu);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('resize', measure);
  };
});

onBeforeUnmount(() => dispose());
</script>

<template>
  <div class="map-canvas">
    <canvas ref="canvas" aria-label="会場の地図" />
    <button type="button" class="compass" aria-label="向きを戻す" @click="resetNorth(goal)">
      <svg ref="needle" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 15 12H9z" fill="#ff6b6b" />
        <path d="M12 21 9 12h6z" fill="currentColor" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.map-canvas { position: relative; width: 100%; height: 100%; overflow: hidden; }
canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.compass {
  position: absolute; left: 12px; bottom: calc(var(--map-bottom-clearance, 0px) + 32px); display: grid; place-items: center;
  width: 44px; height: 44px; padding: 0; border: 1px solid currentColor; border-radius: 12px;
  color: var(--app-text-primary); background: var(--app-bg-surface); cursor: pointer;
}
.compass svg { transform-origin: center; }
</style>
