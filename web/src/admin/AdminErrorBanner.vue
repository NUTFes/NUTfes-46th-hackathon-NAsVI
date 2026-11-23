<script setup lang="ts">
import { computed } from 'vue';
import { ApiError } from '../api/client';
import { adminTokens } from './tokens';

const props = defineProps<{ error: unknown }>();
defineEmits<{ reload: [] }>();

const problem = computed(() => props.error instanceof ApiError ? props.error : null);
const unauthorized = computed(() => problem.value?.status === 401);
const title = computed(() => unauthorized.value
  ? '運営の権限が必要です'
  : props.error instanceof TypeError ? '通信に失敗しました' : '操作に失敗しました');
</script>

<template>
  <section v-if="error != null" class="admin-error" :style="adminTokens" role="alert" data-tone="error">
    <span class="admin-error__icon" aria-hidden="true">!</span>
    <div class="admin-error__content">
      <h2>{{ title }}</h2>
      <p v-if="problem">{{ problem.message }}</p>
      <p v-else>通信環境を確認し、もう一度読み込んでください。</p>
      <dl v-if="problem">
        <div><dt>コード</dt><dd>{{ problem.code }}</dd></div>
        <div v-if="problem.field"><dt>項目</dt><dd>{{ problem.field }}</dd></div>
      </dl>
      <p v-if="unauthorized">
        「認証し直す」で運営画面を開き直し、Cloudflare Access で運営としてログインしてください。
        ログイン後も表示される場合は、実行委員の管理担当者に権限を確認してください。
      </p>
      <p v-else-if="problem?.field">入力内容を確認して、もう一度操作してください。</p>
      <p v-else-if="problem">時間をおいて、もう一度読み込んでください。</p>
      <button type="button" @click="$emit('reload')">
        {{ unauthorized ? '認証し直す' : 'もう一度読み込む' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.admin-error {
  display: flex;
  align-items: flex-start;
  gap: var(--admin-space-md);
  padding: var(--admin-space-lg);
  border: thin solid var(--admin-danger);
  border-radius: var(--admin-radius);
  background: var(--admin-danger-bg);
  color: var(--admin-danger-text);
  font-family: var(--admin-font);
  font-size: var(--admin-body-size);
  font-weight: var(--admin-weight);
  overflow-wrap: anywhere;
}
.admin-error__icon { font-weight: var(--admin-bold); }
.admin-error__content { min-width: 0; display: grid; gap: var(--admin-space-md); }
h2, p, dl, dd { margin: 0; }
h2 { font-size: var(--admin-banner-title-size); font-weight: var(--admin-bold); }
dl { display: grid; gap: var(--admin-space-xs); }
dl > div { display: flex; flex-wrap: wrap; gap: var(--admin-space-sm); }
dt { font-weight: var(--admin-bold); }
button {
  justify-self: start;
  min-height: var(--admin-touch-target);
  padding: var(--admin-space-sm) var(--admin-space-lg);
  border: thin solid currentColor;
  border-radius: var(--admin-radius);
  background: var(--admin-danger-bg);
  color: inherit;
  font: inherit;
  font-weight: var(--admin-bold);
  cursor: pointer;
}
button:focus-visible { outline: solid var(--admin-danger); outline-offset: var(--admin-space-xs); }
</style>
