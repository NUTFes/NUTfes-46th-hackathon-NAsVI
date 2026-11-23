<script setup lang="ts">
import Icon, { type IconName } from './Icon.vue';

withDefaults(defineProps<{
  icon: IconName;
  label: string; // 読み上げ用の名前（必須）。無効のときは理由を足す
  disabled?: boolean;
  pressed?: boolean; // 押下の見た目を固定で出す
  plain?: boolean; // 面と枠を出さない（SearchField の消去など）
  size?: number; // アイコンの大きさ(px)。押す領域は 44px のまま
}>(), { disabled: false, pressed: false, plain: false, size: 20 });

const emit = defineEmits<{ press: [] }>();
</script>

<template>
  <button
    type="button"
    class="nv-ibtn"
    :class="{ 'nv-ibtn--plain': plain }"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
    :data-pressed="pressed ? 'true' : undefined"
    @click="emit('press')"
  >
    <Icon :name="icon" :size="size" />
  </button>
</template>

<style scoped>
.nv-ibtn {
  box-sizing: border-box;
  width: var(--app-touch, 44px); /* size.touch-target */
  height: var(--app-touch, 44px);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--app-radius, 12px); /* radius.lg */
  background: var(--app-bg-surface); /* bg-surface */
  border: 1px solid var(--app-border-subtle); /* border-subtle */
  color: var(--app-text-primary);
  cursor: pointer;
}
.nv-ibtn--plain { background: transparent; border-color: transparent; color: inherit; }
.nv-ibtn:active:not(:disabled),
.nv-ibtn[data-pressed='true']:not(:disabled) { box-shadow: inset 0 0 0 999px var(--app-state-pressed, var(--state-pressed)); }
.nv-ibtn:disabled { color: var(--app-text-disabled, var(--text-disabled)); opacity: var(--app-disabled, 0.45); cursor: not-allowed; }
.nv-ibtn:focus-visible { outline: 2px solid var(--app-action-primary); outline-offset: var(--app-space-1, 4px); }
</style>
