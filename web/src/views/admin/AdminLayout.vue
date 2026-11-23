<script setup lang="ts">
import { watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import AdminErrorBanner from '../../admin/AdminErrorBanner.vue';
import { provideAdminFeedback } from '../../admin/feedback';
import { adminTokens } from '../../admin/tokens';

const navigation = [
  { to: '/admin/places', label: '場所' },
  { to: '/admin/labels', label: '種類' },
  { to: '/admin/landmarks', label: '建物' },
  { to: '/admin/floorplans', label: '見取り図' },
];
const route = useRoute();
const { error, clearError } = provideAdminFeedback();
watch(() => route.fullPath, clearError);

// 更新 API の自動再送はせず、現在の画面を Access の入口から開き直す。
function reloadPage() { window.location.reload(); }
</script>

<template>
  <div class="admin-layout" :style="adminTokens">
    <header class="admin-layout__header">
      <h1>運営の画面</h1>
      <nav aria-label="運営の管理メニュー">
        <RouterLink v-for="item in navigation" :key="item.to" :to="item.to" exact-active-class="is-current">
          {{ item.label }}
        </RouterLink>
      </nav>
    </header>
    <div class="admin-layout__content">
      <AdminErrorBanner :error="error" @reload="reloadPage" />
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
.admin-layout {
  min-height: 100dvh;
  background: var(--admin-bg);
  color: var(--admin-text);
  font-family: var(--admin-font);
  font-size: var(--admin-body-size);
  font-weight: var(--admin-weight);
}
.admin-layout__header {
  display: grid;
  gap: var(--admin-space-lg);
  padding: var(--admin-space-xl);
  border-bottom: thin solid var(--admin-border);
  background: var(--admin-surface);
}
h1 { margin: 0; font-size: var(--admin-title-size); font-weight: var(--admin-bold); }
nav { display: flex; flex-wrap: wrap; gap: var(--admin-space-sm); }
nav a {
  display: inline-flex;
  align-items: center;
  min-height: var(--admin-touch-target);
  padding-inline: var(--admin-space-lg);
  border-radius: var(--admin-radius);
  color: var(--admin-muted);
  text-decoration: none;
}
nav a.is-current {
  background: var(--admin-selected);
  color: var(--admin-text);
  font-weight: var(--admin-bold);
  text-decoration: underline;
}
nav a:focus-visible { outline: solid var(--admin-action); outline-offset: var(--admin-space-xs); }
.admin-layout__content { display: grid; gap: var(--admin-space-lg); padding: var(--admin-space-xl); }
</style>
