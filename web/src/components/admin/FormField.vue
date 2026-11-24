<script setup lang="ts">
// 運営の入力欄 1 つ分。ラベル・補足・エラーを出す。入力欄（input / textarea / select）は slot に置く。
// 入力欄の見た目（暗い面・border-control の枠・エラーは danger の赤枠）はここで揃える。
// FormField.md の kind（text / textarea / select）は、slot に置く要素そのもので決まる。
withDefaults(defineProps<{
  label: string;
  controlId: string; // label for と結ぶ入力欄の id
  error?: string; // 空なら出さない。赤い枠と、桃の文
  errorId?: string; // 入力欄の aria-describedby に入れる id
  help?: string;
  helpId?: string;
  alert?: boolean; // エラーが出た時に読み上げさせる（role="alert"）
}>(), { error: undefined, errorId: undefined, help: undefined, helpId: undefined, alert: false });
</script>

<template>
  <div class="nv-field" :data-invalid="error ? 'true' : undefined">
    <label class="nv-field__label" :for="controlId">{{ label }}</label>
    <slot />
    <p v-if="help" :id="helpId" class="nv-field__help">{{ help }}</p>
    <p v-if="error" :id="errorId" class="nv-field__error" :role="alert ? 'alert' : undefined">{{ error }}</p>
  </div>
</template>

<style scoped>
.nv-field { display: grid; gap: var(--admin-space-xs); min-width: 0; }
.nv-field__label { color: var(--admin-muted); font-size: var(--admin-label-size); font-weight: var(--admin-bold); } /* text-secondary */
.nv-field__help { margin: 0; color: var(--admin-muted); }
.nv-field__error { margin: 0; color: var(--admin-danger-text); font-weight: var(--admin-bold); } /* danger-text。色だけでなく文で出す */
.nv-field :slotted(:is(input, textarea, select)) {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: var(--admin-touch-target); /* 40px 以上（PC） */
  padding: var(--admin-space-sm) var(--admin-space-md);
  border: thin solid var(--admin-border-control); /* border-control */
  border-radius: var(--admin-radius);
  background: var(--admin-bg); /* bg-page */
  color: var(--admin-text);
  font: inherit;
}
.nv-field :slotted(textarea) { min-height: calc(var(--admin-touch-target) * 2); resize: vertical; }
.nv-field :slotted(:is(input, textarea, select):disabled) { opacity: 0.6; }
.nv-field :slotted(:is(input, textarea, select)[aria-invalid='true']) { border-color: var(--admin-danger); } /* danger */
.nv-field :slotted(:is(input, textarea, select):focus-visible) { outline: solid var(--admin-action); outline-offset: var(--admin-space-xs); }
</style>
