<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import Button from './Button.vue';

const props = withDefaults(defineProps<{
  message: string;
  undoLabel?: string;
  onUndo?: () => void; // 無ければ「取り消す」を出さない
  durationMs?: number; // 0 以下で自動では消さない
  floating?: boolean; // 画面の下（タブバーの上）に浮かせる
}>(), { undoLabel: '取り消す', onUndo: undefined, durationMs: 6000, floating: false });

const emit = defineEmits<{ dismiss: [] }>();

let timer: ReturnType<typeof setTimeout> | undefined;
function arm() {
  clearTimeout(timer);
  if (props.durationMs > 0) timer = setTimeout(() => emit('dismiss'), props.durationMs);
}
onMounted(arm);
watch(() => [props.message, props.durationMs], arm);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="nv-toast" :class="{ 'nv-toast--floating': floating }" role="status">
    <span class="nv-toast__message">{{ message }}</span>
    <Button v-if="onUndo" variant="secondary" size="sm" :label="undoLabel" class="nv-toast__undo" @press="onUndo()" />
  </div>
</template>

<style scoped>
.nv-toast {
  box-sizing: border-box;
  padding: 10px 10px 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: var(--app-radius-xl, 14px); /* radius.xl */
  background: var(--app-bg-surface); /* bg-surface */
  border: 1px solid var(--app-action-primary); /* action-primary */
  color: var(--app-text-primary);
  font-family: var(--app-font, inherit);
  font-size: var(--app-action, 14px);
  font-weight: var(--app-bold, 700);
}
.nv-toast--floating {
  position: fixed;
  left: var(--app-space-4, 16px);
  right: var(--app-space-4, 16px);
  bottom: calc(var(--app-tab-height, 72px) + var(--app-space-4, 16px) + env(safe-area-inset-bottom));
  z-index: 10;
}
.nv-toast__message { flex: 1; min-width: 0; }
.nv-toast__undo { flex: none; min-height: var(--app-touch, 44px); } /* 取り消すの押下領域は 44px */
</style>
