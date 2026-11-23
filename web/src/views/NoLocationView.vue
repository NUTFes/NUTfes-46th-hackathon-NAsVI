<script setup lang="ts">
import { usePosition } from '../services/position';

const { allow, status } = usePosition();
</script>

<template>
  <main class="no-location">
    <section v-if="status !== 'granted'" class="no-location__banner" role="alert">
      <span class="no-location__icon" aria-hidden="true">!</span>
      <div class="no-location__content">
        <h1>現在地が使えません</h1>
        <p>行き先への方角と距離、スタンプは使えません。</p>
        <p>検索・一覧・場所の情報は、このまま使えます。</p>
        <!-- 「地図で指定する」は wireframe.md の OQ-2 が未決のため実装しない。 -->
        <button type="button" @click="allow">位置の利用を許可</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.no-location {
  /* design-system/tokens.json。共通テーマ変数が未設定でもダークの値で表示する。 */
  --noloc-border: var(--danger, #f87171); /* color.dark.danger */
  --noloc-background: var(--danger-bg, #2d1520); /* color.dark.danger-bg */
  --noloc-text: var(--danger-text, #fecaca); /* color.dark.danger-text */
  --noloc-heading: var(--text-primary, #f4f0ff); /* color.dark.text-primary */
  --noloc-action: var(--action-primary, #a78bfa); /* color.dark.action-primary */
  --noloc-on-action: var(--action-on-primary, #1e0b3a); /* color.dark.action-on-primary */
  --noloc-pressed: var(--state-pressed, rgb(255 255 255 / 12%)); /* color.dark.state-pressed */
  --noloc-space-small: 4px; /* space.1 */
  --noloc-space-medium: 8px; /* space.2 */
  --noloc-space-large: 16px; /* space.4 */
  --noloc-radius: 12px; /* radius.lg */
  --noloc-target: 44px; /* size.touch-target */
  --noloc-font: 'Noto Sans JP', sans-serif; /* font.family.base。外部から読み込まない。 */
  --noloc-body-size: 13px; /* font.size.sm */
  --noloc-heading-size: 15px; /* font.size.lg */
  --noloc-action-size: 14px; /* font.size.md */
  --noloc-regular: 400; /* font.weight.regular */
  --noloc-bold: 800; /* font.weight.extra-bold */
  /* design-system/claude-design/tokens.json: type.groups[].styles */
  --noloc-body-line-height: 1.5; /* body.lineHeight */
  --noloc-heading-line-height: 1.35; /* subtitle.lineHeight (Banner 見出しは太さ 800) */
  --noloc-action-line-height: 1.4; /* action.lineHeight */

  padding: var(--noloc-space-large);
  font-family: var(--noloc-font);
  font-size: var(--noloc-body-size);
  line-height: var(--noloc-body-line-height);
  font-weight: var(--noloc-regular);
}

.no-location__banner {
  display: flex;
  align-items: flex-start;
  gap: var(--noloc-space-large);
  padding: var(--noloc-space-large);
  border: thin solid var(--noloc-border);
  border-radius: var(--noloc-radius);
  background: var(--noloc-background);
  color: var(--noloc-text);
}

.no-location__icon {
  color: var(--noloc-border);
  font-size: var(--noloc-heading-size);
  font-weight: var(--noloc-bold);
}

.no-location__content {
  min-width: 0;
  overflow-wrap: anywhere;
}

h1, p {
  margin: 0;
}

h1 {
  margin-bottom: var(--noloc-space-small);
  color: var(--noloc-heading);
  font-size: var(--noloc-heading-size);
  line-height: var(--noloc-heading-line-height);
  font-weight: var(--noloc-bold);
}

button {
  min-width: var(--noloc-target);
  min-height: var(--noloc-target);
  margin-top: var(--noloc-space-medium);
  padding: var(--noloc-space-medium) var(--noloc-space-large);
  border: 0;
  border-radius: var(--noloc-radius);
  background: var(--noloc-action);
  color: var(--noloc-on-action);
  font: inherit;
  font-size: var(--noloc-action-size);
  line-height: var(--noloc-action-line-height);
  font-weight: var(--noloc-bold);
  cursor: pointer;
}

button:active {
  background-image: linear-gradient(var(--noloc-pressed), var(--noloc-pressed));
}

button:focus-visible {
  outline: solid var(--noloc-action);
  outline-offset: var(--noloc-space-small);
}
</style>
