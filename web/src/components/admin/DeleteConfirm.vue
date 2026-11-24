<script setup lang="ts">
import { ref } from 'vue';
import Button from '../ui/Button.vue';

// 運営が、消す前に連動して起きることを見て決める。赤い枠の面に「削除する」(左)・「やめる」(右)。
// 最初のフォーカスは「やめる」。native の dialog の中に置くときは role="none" にして、dialog 側に alertdialog を付ける。
withDefaults(defineProps<{
  title: string; // 「〇〇」を削除しますか？
  effects?: string; // 連動して起きること。複数の文・箇条書きは default slot で渡す
  busy?: boolean;
  role?: 'alertdialog' | 'none';
  level?: 2 | 3;
  titleId?: string;
  effectsId?: string;
}>(), { effects: undefined, busy: false, role: 'alertdialog', level: 3, titleId: 'delete-title', effectsId: 'delete-effects' });

defineEmits<{ confirm: []; cancel: [] }>();

const cancelButton = ref<{ $el: HTMLButtonElement }>();
defineExpose({ focusCancel: () => cancelButton.value?.$el.focus() });
</script>

<template>
  <section
    class="nv-delete" :role="role === 'none' ? undefined : role"
    :aria-labelledby="role === 'none' ? undefined : titleId" :aria-describedby="role === 'none' ? undefined : effectsId"
  >
    <component :is="`h${level}`" :id="titleId" class="nv-delete__title">{{ title }}</component>
    <slot name="status" />
    <div :id="effectsId" class="nv-delete__effects">
      <p v-if="effects">{{ effects }}</p>
      <slot />
    </div>
    <div class="nv-delete__actions">
      <Button variant="danger" size="md" label="削除する" :disabled="busy" @press="$emit('confirm')" />
      <Button ref="cancelButton" variant="secondary" size="md" label="やめる" :disabled="busy" autofocus @press="$emit('cancel')" />
    </div>
  </section>
</template>

<style scoped>
.nv-delete {
  display: grid; gap: var(--admin-space-md); box-sizing: border-box; min-width: 0;
  padding: var(--admin-space-lg);
  border: thin solid var(--admin-danger); /* danger */
  border-radius: var(--admin-radius);
  background: var(--admin-danger-bg); /* danger-bg */
  color: var(--admin-text);
}
.nv-delete__title { margin: 0; font-size: var(--admin-banner-title-size); font-weight: var(--admin-bold); }
.nv-delete__effects { display: grid; gap: var(--admin-space-sm); color: var(--admin-muted); }
.nv-delete__effects :deep(:is(p, ul)) { margin: 0; }
.nv-delete__effects :deep(ul) { padding-inline-start: var(--admin-space-xl); }
.nv-delete__actions { display: flex; flex-wrap: wrap; gap: var(--admin-space-sm); }
</style>
