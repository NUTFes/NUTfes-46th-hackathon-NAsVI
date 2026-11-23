<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useAppTokens } from '../app/tokens';
import Button from '../components/ui/Button.vue';
import Icon from '../components/ui/Icon.vue';
import { bearingDeg, distanceM } from '../domain/geo';
import { usePosition } from '../services/position';
import { getStorage } from '../storage';
import { useLandmarksStore, usePlacesStore } from '../stores';
import type { Destination } from '../types';

// OQ-18 / DestinationCard の既存の仮置き。確定した値ではない。
const ARRIVAL_DISTANCE_M = 20;
const STALE_AFTER_MS = 30_000;
const DIRECTIONS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'] as const;

// 色・余白・文字は I-0 の --app-*（app/tokens.ts）。ライト・ダークの切替も useAppTokens が追従する。
const root = ref<HTMLElement>();
const tokens = useAppTokens(root);

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
// 着いた状態の説明。Figma の例文「会場は 2 階の廊下です。…」のうち、階だけを既存のデータから出す。
const arrivedNote = computed(() => (place.value?.floor != null ? `会場は ${place.value.floor} 階です。` : '')
  + (place.value?.landmarkId ? '建物の中の地図で、階と場所を確かめられます。' : ''));
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

// W-09 が出来事 placeRemoved で先に行き先を解除する。
// この watch は、一覧の取り直しで行き先の場所が消えていた場合の備え。
// S-08 の結線側が場所の取得完了まで画面を出さないことを前提とする。
// stores に取得状態がないため、0 件は未取得扱いにして自動解除しない。
watch(() => !loading.value && destination.value !== null && places.items.length > 0 && !place.value, missing => {
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
  <main ref="root" class="guide-view" :style="tokens">
    <h1 class="sr-only">案内中</h1>
    <p v-if="loading" role="status">行き先を確認しています</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section v-if="!loading && !unavailable && destination && place" class="destination-card" aria-label="行き先への案内">
      <div class="card-heading">
        <span class="direction-mark" aria-hidden="true">
          <Icon v-if="arrived" name="check" :size="28" />
          <!-- 北を上にした方角。端末の向きに対する角度ではない。 -->
          <Icon v-else-if="guide" name="navigation" :size="28" filled :rotate="guide.bearing" />
          <span v-else>?</span>
        </span>
        <div class="place-heading">
          <p class="eyebrow" role="status">
            <span v-if="arrived" class="sr-only">行き先に着きました。</span>案内中<template v-if="where">・{{ where }}</template>
          </p>
          <h2>{{ place.name }}</h2>
          <p v-if="guide" class="caption" :class="{ stale }">
            <span v-if="stale">更新が止まっています・</span>{{ updated }}・{{ accuracy }}
          </p>
        </div>
        <!-- 距離は北基準の直線距離。「約」は読み上げにだけ残す（追加決定）。到着したら出さない。 -->
        <p
          v-if="guide && !arrived"
          class="distance"
          :aria-label="`直線距離 約 ${Math.round(guide.distance)} m、方角 ${direction}（北を基準）`"
        >
          <span class="distance-value" aria-hidden="true">{{ Math.round(guide.distance) }}<small>m</small></span>
          <span class="direction" aria-hidden="true">{{ direction }}</span>
        </p>
      </div>

      <p v-if="arrived && arrivedNote" class="note">{{ arrivedNote }}</p>
      <div v-if="!guide" class="position-banner" role="status">
        <p>{{ status === 'asking' ? '現在地を確認しています' : '現在地が使えません' }}</p>
        <p class="caption">方角と直線距離を表示できません。</p>
        <RouterLink class="action" :to="{ name: 'noloc' }">位置の設定を確認する</RouterLink>
      </div>

      <div class="actions">
        <RouterLink v-if="!arrived" class="action" :to="{ name: 'camera' }">
          <Icon name="camera" :size="16" />カメラで見る
        </RouterLink>
        <RouterLink v-else-if="place.landmarkId" class="action" :to="{ name: 'building', params: { id: place.landmarkId } }">
          建物の中の地図
        </RouterLink>
        <Button
          class="stop"
          :variant="arrived ? 'destination' : 'secondary'"
          :label="arrived ? '案内を終える' : '案内をやめる'"
          :disabled="clearing"
          @press="clearDestination"
        />
      </div>
    </section>

    <section v-else-if="!loading" class="empty-state">
      <p role="status">{{ unavailable ? 'この場所は案内できなくなりました' : finished ? '案内を終了しました' : '行き先が選ばれていません' }}</p>
      <p class="caption">マップから行き先を選べます。</p>
      <Button v-if="destination" variant="secondary" label="案内を終える" :disabled="clearing" @press="clearDestination" />
      <RouterLink class="action" :to="{ name: 'map' }">マップへ</RouterLink>
    </section>
  </main>
</template>

<style scoped>
.guide-view {
  --guide-radius: 14px; /* radius.xl */
  --guide-control-radius: var(--app-radius); /* radius.lg */
  --guide-caption: 12px; /* font.size.xs */
  --guide-distance: 28px; /* font.size.4xl */
  --guide-extra-bold: 800; /* font.weight.extra-bold */
  box-sizing: border-box;
  padding: var(--app-space-4);
  color: var(--app-text-primary);
  background: var(--app-bg-page);
  font-family: var(--app-font);
  font-size: var(--app-body);
  font-weight: var(--app-regular);
  line-height: var(--app-leading);
}
h1, h2, p { margin: 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.destination-card, .empty-state {
  display: grid;
  gap: var(--app-space-3);
  padding: var(--app-space-4);
  background: var(--app-bg-surface);
  border: 1px solid var(--app-destination-border);
  border-radius: var(--guide-radius);
}
.card-heading { display: flex; align-items: flex-start; gap: var(--app-space-3); }
.direction-mark {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  background: var(--app-destination);
  color: var(--app-destination-on);
  border-radius: var(--guide-control-radius);
  font-size: var(--app-title);
  font-weight: var(--guide-extra-bold);
}
.place-heading { flex: 1; min-width: 0; display: grid; gap: 2px; }
h2 {
  font-size: var(--app-title);
  font-weight: var(--guide-extra-bold);
  line-height: 1.35;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.eyebrow { color: var(--app-destination-text); font-size: var(--guide-caption); font-weight: var(--app-bold); }
.caption { color: var(--app-text-secondary); font-size: var(--guide-caption); }
.distance { flex: none; display: grid; justify-items: end; gap: 2px; text-align: right; }
.distance-value { font-size: var(--guide-distance); font-weight: var(--guide-extra-bold); line-height: 1.1; }
.distance-value small { margin-left: 2px; font-size: var(--guide-caption); font-weight: var(--app-bold); }
.direction { color: var(--app-destination-text); font-size: var(--guide-caption); font-weight: var(--guide-extra-bold); }
.note { color: var(--app-text-secondary); font-size: var(--guide-caption); }
.actions { display: flex; flex-wrap: wrap; gap: var(--app-space-2); }
.actions > .action, .actions > .stop { flex: 1; }
.action {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--app-space-2);
  min-height: var(--app-touch);
  padding: var(--app-space-2) var(--app-space-3);
  border: 1px solid var(--app-border-control);
  border-radius: var(--guide-control-radius);
  color: var(--app-text-primary);
  background: transparent;
  font: var(--app-bold) var(--app-action) / 1.4 var(--app-font);
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}
.action:focus-visible { outline: 2px solid var(--app-action-primary); outline-offset: var(--app-space-1); }
.stale { color: var(--app-stale); }
.error { color: var(--app-danger-text); margin-bottom: var(--app-space-3); }
.position-banner { display: grid; gap: var(--app-space-2); }
.empty-state { border-color: var(--app-border-control); }
</style>
