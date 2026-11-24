<script setup lang="ts">
// Figma: BuildingCameraOverlay(64:3316)。状態の丸薬・正面の建物の丸薬・十字・ミニマップ・ヒントの丸薬。
// state=unknown は向きが分からない形(丸薬の ● が赤、左右のドラッグの案内)。recognized-low は決定(#167)により実装しない。
withDefaults(defineProps<{
  state?: 'recognized' | 'unknown';
  hint?: string;
}>(), { state: 'recognized', hint: '左右にドラッグして向きを合わせる' });
</script>

<template>
  <div class="nv-cam-overlay" :data-state="state">
    <div class="nv-cam-overlay__status">
      <span class="nv-cam-overlay__dot" aria-hidden="true" />
      <slot name="status" />
    </div>
    <div class="nv-cam-overlay__front"><slot name="front" /></div>
    <span class="nv-cam-overlay__cross" aria-hidden="true" />
    <div v-if="state === 'unknown'" class="nv-cam-overlay__hint">{{ hint }}</div>
    <template v-if="state === 'unknown'">
      <span class="nv-cam-overlay__chevron nv-cam-overlay__chevron--left" aria-hidden="true" />
      <span class="nv-cam-overlay__chevron nv-cam-overlay__chevron--right" aria-hidden="true" />
    </template>
    <div class="nv-cam-overlay__minimap"><slot name="minimap" /></div>
  </div>
</template>

<style>
.nv-cam-overlay {
  --_cross-top: 35.75%; /* Figma: 十字の中心 y=277 / 全体 772 */
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: var(--ar-font, var(--app-font, inherit));
}
.nv-cam-overlay > * { position: absolute; }
.nv-cam-overlay__status {
  top: calc(env(safe-area-inset-top) + 14px);
  left: calc(env(safe-area-inset-left) + 16px);
  max-width: calc(100% - 32px - env(safe-area-inset-left) - env(safe-area-inset-right));
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--ar-border-subtle, var(--app-border-subtle));
  border-radius: 999px;
  background: var(--ar-surface, var(--app-bg-surface));
  color: var(--ar-text, var(--app-text-primary));
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
.nv-cam-overlay__status > :not(.nv-cam-overlay__dot) { overflow: hidden; text-overflow: ellipsis; }
.nv-cam-overlay__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ar-event, var(--app-event));
}
.nv-cam-overlay[data-state='unknown'] .nv-cam-overlay__dot { background: var(--ar-danger, var(--app-danger)); }
.nv-cam-overlay__front {
  left: 0;
  right: 0;
  top: calc(var(--_cross-top) - 50px);
  display: flex;
  justify-content: center;
}
.nv-cam-overlay__front > * { pointer-events: auto; }
.nv-cam-overlay__cross {
  top: var(--_cross-top);
  left: 50%;
  width: 24px;
  height: 24px;
  transform: translate(-50%, -50%);
  opacity: 0.8;
  background:
    linear-gradient(var(--ar-facility, var(--app-facility)), var(--ar-facility, var(--app-facility))) center / 24px 2px no-repeat,
    linear-gradient(var(--ar-facility, var(--app-facility)), var(--ar-facility, var(--app-facility))) center / 2px 24px no-repeat;
}
.nv-cam-overlay__hint {
  top: calc(var(--_cross-top) + 28px);
  left: 50%;
  transform: translateX(-50%);
  box-sizing: border-box;
  max-width: calc(100% - 32px);
  padding: 8px 16px;
  border: 1px solid var(--ar-border-subtle, var(--app-border-subtle));
  border-radius: 999px;
  background: var(--ar-surface, var(--app-bg-surface));
  color: var(--ar-text, var(--app-text-primary));
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
.nv-cam-overlay__chevron {
  top: calc(var(--_cross-top) + 40px);
  width: 24px;
  height: 24px;
  opacity: 0.35;
  background: var(--ar-facility, var(--app-facility));
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 5l7 7-7 7'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 5l7 7-7 7'/%3E%3C/svg%3E") center / contain no-repeat;
}
.nv-cam-overlay__chevron--left { left: 0; transform: scaleX(-1); }
.nv-cam-overlay__chevron--right { right: 0; }
.nv-cam-overlay__minimap {
  top: calc(env(safe-area-inset-top) + 122px);
  right: calc(env(safe-area-inset-right) + 16px);
  width: 76px;
  height: 76px;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--ar-border-subtle, var(--app-border-subtle));
  border-radius: 12px; /* radius.lg */
  background: var(--ar-surface, var(--app-bg-surface));
}
</style>
