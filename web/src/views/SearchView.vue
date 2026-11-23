<script setup lang="ts">
import ListView from './ListView.vue';
</script>

<template>
  <!-- 検索・一覧は同じストアと端末内の絞り込みを使い、検索ではタグボタンを出さない。 -->
  <ListView search-mode />
</template>
