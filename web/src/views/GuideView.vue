<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { bearingDeg, distanceM } from '../domain/geo';
import { usePosition } from '../services/position';
import { getStorage } from '../storage';
import { useLandmarksStore, usePlacesStore } from '../stores';
import type { Destination } from '../types';

// OQ-18 / DestinationCard の既存の仮置き。確定した値ではない。
const ARRIVAL_DISTANCE_M = 20;
const STALE_AFTER_MS = 30_000;
const DIRECTIONS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'] as const;

const places = usePlacesStore();
const landmarks = useLandmarksStore();
const router = useRouter();
// 許可・再取得は位置の画面が担当する。ここでは共有中の位置を読むだけ。
const { position, status } = usePosition();
// 行き先の Pinia ストアは未提供。contracts.md §8 の端末内保存を使う。
const destination = ref<Destination | null>(null);
const loading = ref(true);
const clearing = ref(false);
const finished = ref(false);
const unavailable = ref(false);
const error = ref('');
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
let disposed = false;

const place = computed(() => places.items.find(item => item.id === destination.value?.placeId));
const building = computed(() => landmarks.items.find(item => item.id === place.value?.landmarkId));
const where = computed(() => [building.value?.name, place.value?.floor != null ? `${place.value.floor}階` : null]
  .filter(Boolean).join(' '));
const guide = computed(() => {
  const from = position.value;
  const to = place.value?.location;
  if (!from || !to || ![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) return null;
  return { distance: distanceM(from, to), bearing: bearingDeg(from, to) };
});
const arrived = computed(() => guide.value !== null && guide.value.distance <= ARRIVAL_DISTANCE_M);
const direction = computed(() => guide.value ? DIRECTIONS[Math.round(guide.value.bearing / 45) % 8] : '');
const ageSeconds = computed(() => position.value && Number.isFinite(position.value.takenAt)
  ? Math.floor(Math.max(0, now.value - position.value.takenAt) / 1000) : null);
const stale = computed(() => ageSeconds.value !== null && ageSeconds.value * 1000 >= STALE_AFTER_MS);
const updated = computed(() => {
  const seconds = ageSeconds.value;
  if (seconds === null) return '更新時刻不明';
  return seconds < 60 ? `${seconds} 秒前に更新` : `${Math.floor(seconds / 60)} 分前に更新`;
});
const accuracy = computed(() => {
  const value = position.value?.accuracy;
  return value != null && Number.isFinite(value) && value >= 0 ? `精度 ±${Math.round(value)} m` : '精度不明';
});

watch(() => !loading.value && destination.value !== null && !place.value, missing => {
  if (!missing) return;
  // API-5 / remove-clears-destination: 端末内で終了。地図へ自動で戻すのは今回の追加決定。
  unavailable.value = true;
  void clearDestination();
});

onMounted(async () => {
  ticker = setInterval(() => { now.value = Date.now(); }, 1000);
  try {
    const storage = await getStorage();
    const saved = await storage.destination.get();
    if (!disposed) destination.value = saved;
  } catch {
    if (!disposed) error.value = '行き先を読み込めませんでした。マップからもう一度選んでください。';
  } finally {
    if (!disposed) loading.value = false;
  }
});

onUnmounted(() => {
  disposed = true;
  clearInterval(ticker);
});

async function clearDestination() {
  if (clearing.value) return;
  clearing.value = true;
  error.value = '';
  try {
    const storage = await getStorage();
    // D-026: 到着の表示だけでは消さない。削除時も手動の終了と同じ clear を使う。
    await storage.destination.clear();
    if (!disposed) {
      destination.value = null;
      finished.value = true;
      if (unavailable.value) await router.replace({ name: 'map' });
    }
  } catch {
    if (!disposed) error.value = '案内を終えられませんでした。もう一度お試しください。';
  } finally {
    if (!disposed) clearing.value = false;
  }
}
</script>

<template>
  <main class="guide-view">
    <h1>案内中</h1>
    <p v-if="loading" role="status">行き先を確認しています</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section v-if="!loading && !unavailable && destination && place" class="destination-card" aria-label="行き先への案内">
      <div class="card-heading">
        <span class="direction-mark" aria-hidden="true">
          <span v-if="arrived">✓</span>
          <!-- 北を上にした方角。端末の向きに対する角度ではない。 -->
          <svg v-else-if="guide" viewBox="0 0 24 24" :style="{ transform: `rotate(${guide.bearing}deg)` }">
            <path d="M12 2 21 21 12 17 3 21Z" fill="currentColor" />
          </svg>
          <span v-else>?</span>
        </span>
        <div class="place-heading">
          <p class="eyebrow" role="status">{{ arrived ? '行き先に着きました' : '案内中' }}</p>
          <h2>{{ place.name }}</h2>
          <p v-if="where" class="caption">{{ where }}</p>
        </div>
      </div>

      <template v-if="guide">
        <!-- 距離表記の追加決定: 「約」+ 整数 m。 -->
        <p class="distance">直線距離 <strong>約 {{ Math.round(guide.distance) }} m</strong></p>
        <p>方角：{{ direction }}（北を基準）</p>
        <p class="caption" :class="{ stale }">
          <span v-if="stale">更新が止まっています・</span>{{ updated }}・{{ accuracy }}
        </p>
      </template>
      <div v-else class="position-banner" role="status">
        <p>{{ status === 'asking' ? '現在地を確認しています' : '現在地が使えません' }}</p>
        <p class="caption">方角と直線距離を表示できません。</p>
        <RouterLink class="action" :to="{ name: 'noloc' }">位置の設定を確認する</RouterLink>
      </div>

      <div class="actions">
        <RouterLink v-if="!arrived" class="action" :to="{ name: 'camera' }">カメラで見る</RouterLink>
        <RouterLink v-else-if="place.landmarkId" class="action" :to="{ name: 'building', params: { id: place.landmarkId } }">
          建物の中の地図
        </RouterLink>
        <button type="button" class="action" :class="{ finish: arrived }" :disabled="clearing" @click="clearDestination">
          {{ arrived ? '案内を終える' : '案内をやめる' }}
        </button>
      </div>
    </section>

    <section v-else-if="!loading" class="empty-state">
      <p role="status">{{ unavailable ? 'この場所は案内できなくなりました' : finished ? '案内を終了しました' : '行き先が選ばれていません' }}</p>
      <p class="caption">マップから行き先を選べます。</p>
      <button v-if="destination" type="button" class="action" :disabled="clearing" @click="clearDestination">案内を終える</button>
      <RouterLink class="action" :to="{ name: 'map' }">マップへ</RouterLink>
    </section>
  </main>
</template>

<style scoped>
.guide-view {
  /* design-system/tokens.json: 親の color.{dark,light}.* を優先する。
     テーマ切替は design-system/claude-design/tokens.css の意味トークンに依存。
     未提供時は color.light.* の組み合わせで文字・背景・縁のコントラストを保つ。 */
  --guide-page: var(--bg-page, #f6f4fa); /* color.light.bg-page */
  --guide-surface: var(--bg-surface, #ffffff); /* color.light.bg-surface */
  --guide-text: var(--text-primary, #1e0b3a); /* color.light.text-primary */
  --guide-secondary: var(--text-secondary, #5b5274); /* color.light.text-secondary */
  --guide-destination: var(--destination, #facc15); /* color.light.destination */
  --guide-destination-on: var(--destination-on, #1e0b3a); /* color.light.destination-on */
  --guide-destination-border: var(--destination-border, #1e0b3a); /* color.light.destination-border */
  --guide-border: var(--border-subtle, #1e0b3a26); /* color.light.border-subtle */
  --guide-focus: var(--action-primary, #6d28d9); /* color.light.action-primary */
  --guide-stale: var(--stale, #c2410c); /* color.light.stale */
  --guide-danger: var(--danger-text, #b91c1c); /* color.light.danger-text */
  --guide-space-1: 4px; /* space.1 */
  --guide-space-2: 8px; /* space.2 */
  --guide-space-3: 12px; /* space.3 */
  --guide-space-4: 16px; /* space.4 */
  --guide-radius: 14px; /* radius.xl */
  --guide-control-radius: 10px; /* radius.md */
  --guide-touch: 44px; /* size.touch-target */
  --guide-font: 'Noto Sans JP', sans-serif; /* font.family.base (端末内のフォントのみ) */
  --guide-body: 13px; /* font.size.sm */
  --guide-caption: 12px; /* font.size.xs */
  --guide-action: 14px; /* font.size.md */
  --guide-title: 20px; /* font.size.2xl */
  --guide-distance: 28px; /* font.size.4xl */
  --guide-regular: 400; /* font.weight.regular */
  --guide-bold: 700; /* font.weight.bold */
  --guide-extra-bold: 800; /* font.weight.extra-bold */
  --guide-disabled: 0.45; /* opacity.disabled */
  /* design-system/claude-design/tokens.css: .body / .title / .action */
  --guide-body-leading: 1.5;
  --guide-title-leading: 1.35;
  --guide-action-leading: 1.4;
  box-sizing: border-box;
  padding: var(--guide-space-4);
  color: var(--guide-text);
  background: var(--guide-page);
  font-family: var(--guide-font);
  font-size: var(--guide-body);
  font-weight: var(--guide-regular);
  line-height: var(--guide-body-leading);
}
h1, h2, p { margin: 0; }
h1, h2 {
  font-size: var(--guide-title);
  font-weight: var(--guide-extra-bold);
  line-height: var(--guide-title-leading);
}
h1 { margin-bottom: var(--guide-space-4); }
.destination-card, .empty-state {
  display: grid;
  gap: var(--guide-space-3);
  padding: var(--guide-space-4);
  background: var(--guide-surface);
  border: 1px solid var(--guide-destination-border);
  border-radius: var(--guide-radius);
}
.card-heading { display: flex; align-items: center; gap: var(--guide-space-3); }
.direction-mark {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--guide-touch);
  height: var(--guide-touch);
  background: var(--guide-destination);
  color: var(--guide-destination-on);
  border: 1px solid var(--guide-destination-border);
  border-radius: var(--guide-control-radius);
  font-size: var(--guide-distance);
}
.direction-mark svg { width: var(--guide-title); height: var(--guide-title); }
.place-heading { min-width: 0; }
h2 { overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.eyebrow, .caption { color: var(--guide-secondary); font-size: var(--guide-caption); }
.distance strong { font-size: var(--guide-distance); font-weight: var(--guide-extra-bold); }
.actions { display: flex; flex-wrap: wrap; gap: var(--guide-space-2); }
.actions > .action { flex: 1; }
.action {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--guide-touch);
  padding: var(--guide-space-2) var(--guide-space-3);
  border: 1px solid var(--guide-border);
  border-radius: var(--guide-control-radius);
  color: var(--guide-text);
  background: var(--guide-surface);
  font: var(--guide-bold) var(--guide-action) / var(--guide-action-leading) var(--guide-font);
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}
.action:focus-visible { outline: 2px solid var(--guide-focus); outline-offset: var(--guide-space-1); }
.action:disabled { opacity: var(--guide-disabled); cursor: default; }
.finish { color: var(--guide-destination-on); background: var(--guide-destination); border-color: var(--guide-destination-border); }
.stale { color: var(--guide-stale); }
.error { color: var(--guide-danger); margin-bottom: var(--guide-space-3); }
.position-banner { display: grid; gap: var(--guide-space-2); }
.empty-state { border-color: var(--guide-border); }
</style>
