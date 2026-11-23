<script lang="ts">
import type { IconName } from './Icon.vue';

export type ButtonVariant = 'primary' | 'secondary' | 'destination' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
/** Banner・EmptyState が Button を並べるときの 1 つ分 */
export type ButtonAction = {
  label: string;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  onPress?: () => void;
};
</script>

<script setup lang="ts">
import Icon from './Icon.vue';

withDefaults(defineProps<{
  label: string; // 押すと起きることを動詞で（読み上げもこれ）
  variant?: ButtonVariant; // primary 主 / secondary 副 / destination 行き先 / danger 危険
  size?: ButtonSize; // md 44px / lg 48px / sm 36px（表の中だけ）
  icon?: IconName;
  iconFilled?: boolean;
  disabled?: boolean;
  pressed?: boolean; // 押下の見た目を固定で出す（Figma の pressed 状態。:active でも同じ見た目）
  type?: 'button' | 'submit';
}>(), { variant: 'primary', size: 'md', icon: undefined, iconFilled: false, disabled: false, pressed: false, type: 'button' });

const emit = defineEmits<{ press: [] }>();
</script>

<template>
  <button
    :type="type"
    class="nv-btn"
    :class="[`nv-btn--${variant}`, `nv-btn--${size}`]"
    :disabled="disabled"
    :data-variant="variant"
    :data-size="size"
    :data-pressed="pressed ? 'true' : undefined"
    @click="emit('press')"
  >
    <Icon v-if="icon" :name="icon" :size="size === 'lg' ? 18 : 16" :filled="iconFilled" />
    <span>{{ label }}</span>
  </button>
</template>

<style scoped>
/* 色は --app-*。I-0 が足す前でも動くよう、tokens.css（design-system/claude-design）の同名トークンに落とす */
.nv-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--app-space-2, 8px); /* space.2 */
  height: var(--app-touch, 44px); /* size.touch-target */
  padding: 0 var(--app-space-4, 16px); /* space.4 */
  border: 1px solid transparent;
  border-radius: var(--app-radius, 12px); /* radius.lg */
  font-family: var(--app-font, inherit);
  font-size: var(--app-action, 14px); /* font.size.md */
  line-height: 1.4;
  font-weight: var(--app-bold, 700); /* font.weight.bold */
  white-space: nowrap;
  cursor: pointer;
}
.nv-btn--lg { height: 48px; font-size: 16px; font-weight: 800; }
.nv-btn--sm { height: 36px; padding: 0 var(--app-space-3, 12px); border-radius: var(--app-radius-md, 10px); font-size: 13px; } /* radius.md */
/* primary: action-primary / action-on-primary */
.nv-btn--primary { background: var(--app-action-primary); border-color: var(--app-action-primary); color: var(--app-action-on-primary); font-weight: 800; }
/* secondary: 透明 / border-control / text-primary */
.nv-btn--secondary { background: transparent; border-color: var(--app-border-control, var(--border-control)); color: var(--app-text-primary); }
/* destination: destination / destination-border / destination-on（行き先にだけ使う黄） */
.nv-btn--destination {
  background: var(--app-destination, var(--destination));
  border-color: var(--app-destination-border, var(--destination-border));
  color: var(--app-destination-on, var(--destination-on));
  font-weight: 800;
}
/* danger: danger / danger-on */
.nv-btn--danger { background: var(--app-danger); border-color: var(--app-danger); color: var(--app-danger-on, var(--danger-on)); font-weight: 800; }
/* pressed: state-pressed を面に重ねる */
.nv-btn:active:not(:disabled),
.nv-btn[data-pressed='true']:not(:disabled) { box-shadow: inset 0 0 0 999px var(--app-state-pressed, var(--state-pressed)); }
/* disabled: opacity.disabled */
.nv-btn:disabled { opacity: var(--app-disabled, 0.45); cursor: not-allowed; }
.nv-btn:focus-visible { outline: 2px solid var(--app-action-primary); outline-offset: var(--app-space-1, 4px); }
</style>
