<script lang="ts">
// Figma: CameraLabel(43:3292)。kind=place は facility 色の小さい札、kind=destination は黄の札と >。
// 建物の奥は不透明度 0.6(Figma の説明)。ArView は札を DOM で直接更新するので、同じクラスを共有する。
export const CAMERA_LABEL_CLASSES = {
  base: 'nv-camera-label',
  name: 'nv-camera-label__name',
  meta: 'nv-camera-label__meta',
  destination: 'nv-camera-label--destination',
  far: 'nv-camera-label--far',
} as const;
</script>

<script setup lang="ts">
withDefaults(defineProps<{
  label: string;
  distance?: string;
  kind?: 'place' | 'destination';
  far?: boolean;
}>(), { distance: '', kind: 'place', far: false });
</script>

<template>
  <span
    :class="[CAMERA_LABEL_CLASSES.base, kind === 'destination' && CAMERA_LABEL_CLASSES.destination, far && CAMERA_LABEL_CLASSES.far]"
    :data-kind="kind"
  >
    <span :class="CAMERA_LABEL_CLASSES.name">{{ label }}</span>
    <span v-if="distance" :class="CAMERA_LABEL_CLASSES.meta">{{ distance }}</span>
  </span>
</template>

<style>
/* ArView は --ar-*(テーマ解決済み)を渡す。単体では --app-*(I-0)を使う。 */
.nv-camera-label.nv-camera-label {
  position: relative;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px; /* space.1 */
  min-height: 0;
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--ar-facility, var(--app-facility, #f4f0ff));
  color: var(--ar-facility-on, var(--app-facility-on, #1e0b3a));
  font-family: var(--ar-font, var(--app-font, inherit));
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  text-align: start;
}
.nv-camera-label.nv-camera-label--destination {
  padding: 5px 8px 5px 10px;
  border-color: var(--ar-destination-border, var(--app-destination-border, #ffd84a));
  border-radius: 8px;
  background: var(--ar-destination, var(--app-destination, #ffd84a));
  color: var(--ar-destination-on, var(--app-destination-on, #1e0b3a));
  font-size: 13px;
}
.nv-camera-label.nv-camera-label--destination::after {
  content: '';
  width: 12px;
  height: 12px;
  background: currentColor;
  /* Icon chevron-right(24 格子、線 2.4) */
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 5l7 7-7 7'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 5l7 7-7 7'/%3E%3C/svg%3E") center / contain no-repeat;
}
/* 見た目は小さい札のまま、押せる範囲を 44px 以上にする。 */
.nv-camera-label::before { content: ''; position: absolute; inset: -13px -4px; }
.nv-camera-label.nv-camera-label--far { opacity: 0.6; }
.nv-camera-label .nv-camera-label__name, .nv-camera-label .nv-camera-label__meta { font-weight: 700; }
</style>
