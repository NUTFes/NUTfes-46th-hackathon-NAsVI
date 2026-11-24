<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { CLOSING_TIME } from '../../../api/src/config';
import { ApiError } from '../api/client';
import { useAppTokens } from '../app/tokens';
import type { components } from '../api/generated/schema';
import Button from '../components/ui/Button.vue';
import Banner from '../components/ui/Banner.vue';
import Icon from '../components/ui/Icon.vue';
import Sheet from '../components/ui/Sheet.vue';
import Toast from '../components/ui/Toast.vue';
import { usePosition } from '../services/position';
import { getStorage, type StampProof, type StorageRepositories } from '../storage';
import { useStampsStore } from '../stores/stamps';
import type { PressedStamp, Stamp, StampKind } from '../types';

const CONGESTION = [
  { kind: 'congestion-1', label: '混雑1 空いている', number: 1 },
  { kind: 'congestion-2', label: '混雑2', number: 2 },
  { kind: 'congestion-3', label: '混雑3', number: 3 },
  { kind: 'congestion-4', label: '混雑4', number: 4 },
  { kind: 'congestion-5', label: '混雑5 とても混んでいる', number: 5 },
] as const;
// 地図の stamps 層と同じ感想のマーク(Icon の fun / food / good)。
const FEELINGS = [
  { kind: 'fun', label: '面白い', icon: 'fun' },
  { kind: 'food', label: '美味しい', icon: 'food' },
  { kind: 'good', label: 'よさ', icon: 'good' },
] as const;
const VISIBLE_COUNT = 3; // MyStampRow: 新しい順に3件まで

const { position, status, allow } = usePosition();
const stamps = useStampsStore();
// 色・余白・文字は I-0 の --app-*(app/tokens.ts)。ライト・ダークの切替も useAppTokens が追従する。
const root = ref<HTMLElement>();
const tokens = useAppTokens(root);
const router = useRouter();
const proofs = ref<StampProof[]>([]);
const ready = ref(false);
const busy = ref(false);
const error = ref('');
const storageWarning = ref('');
const now = ref(Date.now());
const expanded = ref(false);
const toast = ref<Stamp | null>(null);
let storage: StorageRepositories | undefined;
let unsubscribe: (() => void) | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let disposed = false;

const point = computed(() => {
  const value = position.value;
  return value && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90
    && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180 ? value : null;
});
const canPress = computed(() => ready.value && !!point.value && !busy.value);
const accuracy = computed(() => point.value && Number.isFinite(point.value.accuracy)
  && point.value.accuracy >= 0 ? `精度 ±${Math.ceil(point.value.accuracy)} m` : '精度は不明です');
const owned = computed(() => {
  const ids = new Set(proofs.value.filter(proof => Date.parse(proof.expiresAt) > now.value)
    .map(proof => proof.stampId));
  return stamps.activeStamps(now.value).filter(stamp => ids.has(stamp.id))
    .sort((a, b) => Date.parse(b.pressedAt) - Date.parse(a.pressedAt));
});
const visible = computed(() => expanded.value ? owned.value : owned.value.slice(0, VISIBLE_COUNT));
const activeToast = computed(() => toast.value && owned.value.some(stamp => stamp.id === toast.value?.id)
  ? toast.value : null);

function title(kind: StampKind): string {
  return CONGESTION.find(item => item.kind === kind)?.label.split(' ')[0]
    ?? FEELINGS.find(item => item.kind === kind)!.label;
}

function badgeStyle(kind: StampKind) {
  const key = CONGESTION.some(item => item.kind === kind) ? kind : 'feeling';
  return { background: `var(--app-${key})`, color: `var(--app-${key}-on)` };
}

// 札の枠。感想は黒(feeling-on)、混雑は congestion-border。
function pillStyle(kind: StampKind) {
  const border = CONGESTION.some(item => item.kind === kind) ? 'congestion-border' : 'feeling-on';
  return { ...badgeStyle(kind), boxShadow: `inset 0 0 0 1px var(--app-${border})` };
}

function feelingIcon(kind: StampKind) {
  return FEELINGS.find(item => item.kind === kind)?.icon;
}

// Figma の Toast「混雑3 を足元に押しました」。感想は名前にそのまま続ける。
function toastMessage(kind: StampKind): string {
  return `${title(kind)}${kind.startsWith('congestion') ? ' ' : ''}を足元に押しました`;
}

function age(takenAt: number): string {
  const seconds = Math.max(0, Math.floor((now.value - takenAt) / 1000));
  return seconds < 60 ? `${seconds} 秒前` : `${Math.floor(seconds / 60)} 分前`;
}

function remaining(stamp: Stamp): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(stamp.expiresAt) - now.value) / 1000));
  return seconds < 60 ? `あと ${seconds} 秒で消えます` : `あと ${Math.ceil(seconds / 60)} 分で消えます`;
}

function warnMemory(mode: 'indexeddb' | 'memory') {
  storageWarning.value = mode === 'memory'
    ? 'この端末では保存が使えません。画面を再読み込みすると、取り消せなくなります。' : '';
}

function rateLimitMessage(response: Response): string {
  // API-18。秒数・HTTP 日付のどちらも使えなければ、待ち時間を推測しない。
  const value = response.headers.get('Retry-After')?.trim() ?? '';
  const retryAt = Date.parse(value);
  const seconds = /^\d+$/.test(value) ? Number(value)
    : Number.isFinite(retryAt) && new Date(retryAt).toUTCString() === value
      ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : NaN;
  return Number.isSafeInteger(seconds)
    ? `あと ${seconds} 秒ほどおいてからやり直してください。`
    : '短い間に送りすぎました。しばらく待ってからやり直してください。';
}

// 共有クライアントは応答ヘッダーを返さないため、この画面内で読み取る。
// API の基底 URL・本文・proof ヘッダーは共有クライアントと同じ契約を保つ。
async function stampRequest(path: string, init: RequestInit): Promise<Response> {
  const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '');
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json, application/problem+json');
  const response = await fetch(`${base}${path}`, { ...init, headers });
  if (response.ok) return response;
  if (response.status === 429) {
    throw new ApiError({ code: 'too_many_requests', message: rateLimitMessage(response) }, 429);
  }
  const contentType = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (contentType === 'application/problem+json') {
    const problem: unknown = await response.json().catch(() => null);
    if (typeof problem === 'object' && problem !== null
      && 'code' in problem && typeof problem.code === 'string'
      && 'message' in problem && typeof problem.message === 'string'
      && (!('field' in problem) || typeof problem.field === 'string')) {
      throw new ApiError(problem as components['schemas']['Error'], response.status);
    }
  }
  throw new ApiError({ code: 'internal_error', message: '時間をおいて、もう一度試してください' }, response.status);
}

async function loadProofs() {
  ready.value = false;
  error.value = '';
  try {
    const repo = await getStorage();
    await repo.proofs.pruneExpired(Date.now());
    const saved = await repo.proofs.list();
    if (disposed) return;
    storage = repo;
    proofs.value = saved;
    warnMemory(repo.mode);
    unsubscribe?.();
    unsubscribe = repo.onModeChange(warnMemory);
    ready.value = true;
  } catch {
    if (!disposed) error.value = '取り消しに必要な端末の保存を読み込めませんでした。もう一度読み込んでください。';
  }
}

async function press(kind: StampKind) {
  if (!canPress.value || !point.value || !storage) return;
  // StampInput の at だけを送る。精度・takenAt・方位は送らない(API-5)。
  const at = { lat: point.value.lat, lng: point.value.lng };
  busy.value = true;
  error.value = '';
  try {
    const body: components['schemas']['StampInput'] = { kind, at };
    const response = await stampRequest('/stamps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const { proof, ...stamp } = await response.json() as PressedStamp;
    const ownership = { stampId: stamp.id, proof, expiresAt: stamp.expiresAt };
    // proof は公開ストア・キャッシュに混ぜず、専用の端末内ストアに保存する。
    proofs.value = [...proofs.value.filter(item => item.stampId !== stamp.id), ownership];
    stamps.upsert(stamp);
    try {
      await storage.proofs.save(ownership);
    } catch {
      storageWarning.value = '取り消しの証を端末に保存できませんでした。この画面を閉じる前に取り消せます。';
    }
    now.value = Date.now();
    if (!disposed) toast.value = stamp; // 6 秒後の消去は Toast の dismiss
  } catch (cause) {
    error.value = cause instanceof ApiError && cause.status === 400 && cause.code === 'out_of_venue'
      ? '会場の外にいるため、スタンプを押せません。会場内で現在地を確認してからお試しください。'
      : cause instanceof ApiError ? cause.message
      : '送信を確認できませんでした。自分のスタンプを確認し、通信が戻ってからお試しください。';
  } finally {
    busy.value = false;
  }
}

async function retract(stamp: Stamp) {
  const ownership = proofs.value.find(item => item.stampId === stamp.id);
  if (busy.value || !ownership || !storage) return;
  busy.value = true;
  error.value = '';
  try {
    try {
      await stampRequest(`/stamps/${encodeURIComponent(stamp.id)}`, {
        method: 'DELETE', headers: { 'X-Stamp-Proof': ownership.proof },
      });
    } catch (cause) {
      // 別の表示から取り消した場合や期限切れも、手元から消してよい。
      if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
    }
    stamps.remove(stamp.id);
    proofs.value = proofs.value.filter(item => item.stampId !== stamp.id);
    if (toast.value?.id === stamp.id) toast.value = null;
    try {
      await storage.proofs.delete(stamp.id);
    } catch {
      storageWarning.value = 'スタンプは取り消しましたが、端末の保存を更新できませんでした。';
    }
  } catch (cause) {
    error.value = cause instanceof ApiError && cause.status === 403 && cause.code === 'not_stamp_owner'
      ? '期限切れか、別の端末で押したスタンプの可能性があります'
      : cause instanceof ApiError ? cause.message
      : '取り消しを確認できませんでした。通信が戻ってから、もう一度取り消してください。';
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  timer = setInterval(() => { now.value = Date.now(); }, 1000);
  void loadProofs();
});
onUnmounted(() => {
  disposed = true;
  clearInterval(timer);
  unsubscribe?.();
});
</script>
<template>
  <main ref="root" class="stamp-view" :style="tokens">
    <Sheet :level="1" title="混雑を足元に押す" subtitle="いまいる場所の混み具合を、みんなに知らせます。"
      @close="router.push('/')">
      <section class="block" aria-labelledby="stamp-point-title">
        <h2 id="stamp-point-title" class="sr-only">押す地点</h2>
        <template v-if="point">
          <p class="secondary">{{ accuracy }}・{{ age(point.takenAt) }}に取得</p>
          <p class="secondary">スタンプを選ぶと、この地点が公開されます。</p>
        </template>
        <template v-else>
          <p>{{ status === 'asking' ? '現在地を確認中です。' : '現在地がないため、スタンプを押せません。' }}</p>
          <div class="actions">
            <Button label="位置の利用を許可する" :disabled="status === 'asking'" @press="allow" />
            <RouterLink class="link" to="/noloc">位置の設定・地図で指定する</RouterLink>
          </div>
        </template>
      </section>

      <p v-if="storageWarning" class="block warning" role="status">{{ storageWarning }}</p>
      <Banner v-if="error" class="block" tone="error" :title="error"
        :actions="ready ? [] : [{ label: 'もう一度読み込む', variant: 'secondary', onPress: loadProofs }]" />
      <p v-if="!ready && !error" class="block" role="status">端末の保存を読み込んでいます。</p>
      <p v-if="busy" class="block" role="status">通信中です…</p>

      <section class="block" aria-labelledby="stamp-congestion-title" :aria-busy="busy">
        <h2 id="stamp-congestion-title" class="label">混雑</h2>
        <div class="congestion choices">
          <button v-for="item in CONGESTION" :key="item.kind" type="button"
            class="congestion-button" :aria-label="item.label" :disabled="!canPress"
            :style="badgeStyle(item.kind)" @click="press(item.kind)">{{ item.number }}</button>
        </div>
        <p class="scale secondary" aria-hidden="true"><span>空いている</span><span>とても混んでいる</span></p>
      </section>

      <section class="block" aria-labelledby="stamp-feeling-title" :aria-busy="busy">
        <h2 id="stamp-feeling-title" class="label">感想</h2>
        <!-- D-022 / API-17。時刻は既存設定を参照し、押した後の残り時間は expiresAt から表示する。 -->
        <p class="secondary">感想のスタンプは、その日の閉場（{{ CLOSING_TIME }}）まで有効です。</p>
        <div class="feelings choices">
          <button v-for="item in FEELINGS" :key="item.kind" type="button" class="feeling-button"
            :aria-label="item.label" :disabled="!canPress" @click="press(item.kind)">
            <span class="feeling-mark" aria-hidden="true"><Icon :name="item.icon" :size="18" /></span>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </section>

      <section v-if="owned.length" class="block" aria-labelledby="my-stamps-title">
        <h2 id="my-stamps-title" class="label">自分が押したスタンプ</h2>
        <ul>
          <li v-for="stamp in visible" :key="stamp.id" class="my-stamp">
            <span class="badge" :style="pillStyle(stamp.kind)">
              <Icon v-if="feelingIcon(stamp.kind)" :name="feelingIcon(stamp.kind)!" :size="14" />{{ title(stamp.kind) }}
            </span>
            <p class="stamp-time secondary">
              <time :datetime="stamp.pressedAt">{{ age(Date.parse(stamp.pressedAt)) }}</time>
              ・{{ remaining(stamp) }}
            </p>
            <Button variant="secondary" size="sm" label="取り消す" :disabled="busy"
              :aria-label="`${title(stamp.kind)}を取り消す`" @press="retract(stamp)" />
          </li>
        </ul>
        <Button v-if="!expanded && owned.length > VISIBLE_COUNT" variant="secondary" size="sm"
          :label="`ほか ${owned.length - VISIBLE_COUNT} 件を見る`" @press="expanded = true" />
        <p class="secondary">この端末のデータが消えると、取り消せなくなります。</p>
      </section>
    </Sheet>

    <Toast v-if="activeToast" class="toast" floating :message="toastMessage(activeToast.kind)"
      :on-undo="() => retract(activeToast!)" @dismiss="toast = null" />
  </main>
</template>

<style scoped>
.stamp-view {
  box-sizing: border-box;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: var(--app-bg-page);
  color: var(--app-text-primary);
  font: var(--app-regular) var(--app-body) / var(--app-leading) var(--app-font);
}
p, h2, ul { margin: 0; }
.sr-only {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.block { display: grid; gap: var(--app-space-2); margin-bottom: var(--app-space-4); }
.label { font-size: var(--app-body); font-weight: var(--app-bold); color: var(--app-text-secondary); }
.secondary { color: var(--app-text-secondary); }
.warning { color: var(--app-stale); }
.actions { display: grid; gap: var(--app-space-2); }
.link {
  display: inline-flex; align-items: center; justify-content: center; min-height: var(--app-touch);
  color: var(--app-action-primary); font-size: var(--app-action); font-weight: var(--app-bold);
}
.link:focus-visible { outline: 2px solid var(--app-action-primary); outline-offset: var(--app-space-1); }
.choices { display: grid; gap: var(--app-space-2); }
.choices button {
  box-sizing: border-box; font: inherit; font-weight: var(--app-bold); cursor: pointer;
}
.choices button:disabled { opacity: var(--app-disabled); cursor: default; }
.choices button:focus-visible { outline: 2px solid var(--app-action-primary); outline-offset: var(--app-space-1); }
.choices button:active:not(:disabled) { box-shadow: inset 0 0 0 100vmax var(--app-state-pressed); }
/* StampCongestionPicker: 60×52、濃淡と数字 */
.congestion { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.congestion-button {
  min-height: 52px; border: 1px solid var(--app-congestion-border);
  border-radius: var(--app-radius); font-size: var(--app-title); font-weight: 800;
}
.scale { display: flex; justify-content: space-between; gap: var(--app-space-2); font-size: 11px; }
/* StampFeelingButton: 横並び。左に桃色の丸+アイコン、右に文字。高さ 48px */
.feelings { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
.feeling-button {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--app-space-2);
  min-height: 48px; padding: 0 var(--app-space-3);
  background: var(--app-bg-surface); border: 1px solid var(--app-action-primary);
  border-radius: var(--app-radius); color: var(--app-text-primary); font-size: var(--app-action);
}
.feeling-mark {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--app-feeling); color: var(--app-feeling-on);
}
/* MyStampRow: 枠つきの行。札は丸薬、時刻と残りは 1 行、右に外枠の取り消し */
ul { padding: 0; list-style: none; display: grid; gap: var(--app-space-2); }
.my-stamp {
  display: flex; align-items: center; gap: var(--app-space-2); padding: var(--app-space-2) var(--app-space-3);
  border: 1px solid var(--app-border-subtle); border-radius: var(--app-radius);
}
.badge {
  display: inline-flex; align-items: center; gap: 4px; flex: none; padding: 2px 10px;
  border-radius: 999px; font-size: 12px; font-weight: 800; line-height: 1.5; white-space: nowrap;
}
.stamp-time { flex: 1; min-width: 0; font-size: 12px; }
.my-stamp :deep(.nv-btn) { flex: none; }
</style>
