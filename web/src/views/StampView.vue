<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { CLOSING_TIME } from '../../../api/src/config';
import { ApiError } from '../api/client';
import type { components } from '../api/generated/schema';
import { usePosition } from '../services/position';
import { getStorage, type StampProof, type StorageRepositories } from '../storage';
import { useStampsStore } from '../stores/stamps';
import type { PressedStamp, Stamp, StampKind } from '../types';

// map/layers の resolveColors と同じ最寄りテーマ・解決済み値を使う。
// 出典: design-system/claude-design/tokens.css。CSS 変数があればその値を優先する。
const COLOR_TOKENS = {
  page: ['bg-page', '#130a22', '#f6f4fa'], // color.dark/light.bg-page
  surface: ['bg-surface', '#1c1032', '#ffffff'], // color.dark/light.bg-surface
  text: ['text-primary', '#f4f0ff', '#1e0b3a'], // color.dark/light.text-primary
  secondary: ['text-secondary', '#b4a9cf', '#5b5274'], // color.dark/light.text-secondary
  action: ['action-primary', '#a78bfa', '#6d28d9'], // color.dark/light.action-primary
  border: ['border-subtle', '#a78bfa47', '#1e0b3a26'], // color.dark/light.border-subtle
  danger: ['danger-text', '#fecaca', '#b91c1c'], // color.dark/light.danger-text
  'danger-bg': ['danger-bg', '#2d1520', '#fef2f2'], // color.dark/light.danger-bg
  stale: ['stale', '#fdba74', '#c2410c'], // color.dark/light.stale
  pressed: ['state-pressed', '#ffffff1f', '#1e0b3a14'], // color.dark/light.state-pressed
  feeling: ['feeling', '#f9a8d4', '#f472b6'], // color.dark/light.feeling
  'feeling-on': ['feeling-on', '#1e0b3a', '#1e0b3a'], // color.dark/light.feeling-on
  'congestion-border': ['congestion-border', '#fdba74', '#c2410c'], // color.dark/light.congestion-border
  'congestion-1': ['congestion-1', '#ffedd5', '#ffedd5'], // color.dark/light.congestion-1
  'congestion-2': ['congestion-2', '#fdba74', '#fdba74'], // color.dark/light.congestion-2
  'congestion-3': ['congestion-3', '#f97316', '#f97316'], // color.dark/light.congestion-3
  'congestion-4': ['congestion-4', '#c2410c', '#c2410c'], // color.dark/light.congestion-4
  'congestion-5': ['congestion-5', '#7c2d12', '#7c2d12'], // color.dark/light.congestion-5
  'congestion-1-on': ['congestion-1-on', '#1e0b3a', '#1e0b3a'], // color.dark/light.congestion-1-on
  'congestion-2-on': ['congestion-2-on', '#1e0b3a', '#1e0b3a'], // color.dark/light.congestion-2-on
  'congestion-3-on': ['congestion-3-on', '#1e0b3a', '#1e0b3a'], // color.dark/light.congestion-3-on
  'congestion-4-on': ['congestion-4-on', '#ffffff', '#ffffff'], // color.dark/light.congestion-4-on
  'congestion-5-on': ['congestion-5-on', '#ffffff', '#ffffff'], // color.dark/light.congestion-5-on
} as const;

function resolveColors(element: HTMLElement | null): Record<string, string> {
  const theme = element?.closest('[data-theme]')?.getAttribute('data-theme') === 'light' ? 2 : 1;
  const style = element ? getComputedStyle(element) : null;
  // 未解決の var()（基礎色が欠けた場合や DOM テスト）も循環を避けて解決する。
  function resolveVariable(name: string, seen = new Set<string>()): string {
    if (!style || seen.has(name)) return '';
    seen.add(name);
    const value = style.getPropertyValue(name).trim();
    const variable = /^var\((--[\w-]+)\)$/.exec(value);
    return variable ? resolveVariable(variable[1], seen) : value.includes('var(') ? '' : value;
  }
  return Object.fromEntries(Object.entries(COLOR_TOKENS).map(([key, values]) => [
    `--stamp-${key}`, resolveVariable(`--${values[0]}`) || values[theme],
  ]));
}

const TOKENS = {
  '--stamp-space-1': 'var(--space-1, 4px)', // space.1
  '--stamp-space-2': 'var(--space-2, 8px)', // space.2
  '--stamp-space-3': 'var(--space-3, 12px)', // space.3
  '--stamp-space-4': 'var(--space-4, 16px)', // space.4
  '--stamp-radius': 'var(--radius-lg, 12px)', // radius.lg
  '--stamp-target': 'var(--touch-target, 44px)', // size.touch-target
  '--stamp-disabled': 'var(--opacity-disabled, 0.45)', // opacity.disabled
  '--stamp-font': 'var(--font-base, "Noto Sans JP", sans-serif)', // font.family.base
  '--stamp-body-size': '13px', // font.size.sm / typography.body
  '--stamp-body-weight': '400', // font.weight.regular / typography.body
  '--stamp-body-leading': '1.5', // tokens.css .body
  '--stamp-title-size': '20px', // font.size.2xl / typography.title
  '--stamp-heading-size': '16px', // font.size.xl / typography.heading
  '--stamp-heading-weight': '800', // font.weight.extra-bold
  '--stamp-heading-leading': '1.35', // tokens.css .title / .heading
  '--stamp-action-size': '14px', // font.size.md / typography.action
  '--stamp-action-weight': '700', // font.weight.bold / typography.action
  '--stamp-action-leading': '1.4', // tokens.css .action
};
const CONGESTION = [
  { kind: 'congestion-1', label: '混雑1 空いている', number: 1 },
  { kind: 'congestion-2', label: '混雑2', number: 2 },
  { kind: 'congestion-3', label: '混雑3', number: 3 },
  { kind: 'congestion-4', label: '混雑4', number: 4 },
  { kind: 'congestion-5', label: '混雑5 とても混んでいる', number: 5 },
] as const;
// 地図の stamps 層と同じ感想のマーク。
const FEELINGS = [
  { kind: 'fun', label: '面白い', mark: '楽' },
  { kind: 'food', label: '美味しい', mark: '食' },
  { kind: 'good', label: 'よさ', mark: '良' },
] as const;
const VISIBLE_COUNT = 3; // MyStampRow: 新しい順に3件まで
const TOAST_MS = 6000; // Toast.durationMs

const { position, status, allow } = usePosition();
const stamps = useStampsStore();
const root = ref<HTMLElement | null>(null);
const colors = ref(resolveColors(null));
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
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let themeObserver: MutationObserver | undefined;

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
  const congestion = CONGESTION.find(item => item.kind === kind);
  const key = congestion?.kind ?? 'feeling';
  return { background: colors.value[`--stamp-${key}`], color: colors.value[`--stamp-${key}-on`] };
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
    if (!disposed) {
      toast.value = stamp;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.value = null; }, TOAST_MS);
    }
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
  const updateColors = () => { colors.value = resolveColors(root.value); };
  updateColors();
  themeObserver = new MutationObserver(updateColors);
  for (let element = root.value; element; element = element.parentElement) {
    themeObserver.observe(element, { attributes: true, attributeFilter: ['data-theme'] });
  }
  timer = setInterval(() => { now.value = Date.now(); }, 1000);
  void loadProofs();
});
onUnmounted(() => {
  disposed = true;
  clearInterval(timer);
  clearTimeout(toastTimer);
  themeObserver?.disconnect();
  unsubscribe?.();
});
</script>

<template>
  <main ref="root" class="stamp-view" :style="{ ...TOKENS, ...colors }">
    <header>
      <h1>スタンプを押す</h1>
      <RouterLink to="/">マップへ戻る</RouterLink>
    </header>
    <section class="panel" aria-labelledby="stamp-point-title">
      <h2 id="stamp-point-title">押す地点</h2>
      <template v-if="point">
        <p>現在地：緯度 {{ point.lat.toFixed(6) }}・経度 {{ point.lng.toFixed(6) }}</p>
        <p class="secondary">{{ accuracy }}・{{ age(point.takenAt) }}に取得</p>
        <p class="secondary">スタンプを選ぶと、この地点が公開されます。</p>
      </template>
      <template v-else>
        <p>{{ status === 'asking' ? '現在地を確認中です。' : '現在地がないため、スタンプを押せません。' }}</p>
        <button type="button" :disabled="status === 'asking'" @click="allow">位置の利用を許可する</button>
        <RouterLink to="/noloc">位置の設定・地図で指定する</RouterLink>
      </template>
    </section>

    <p v-if="storageWarning" class="warning" role="status">{{ storageWarning }}</p>
    <div v-if="error" class="error" role="alert">
      <p>{{ error }}</p>
      <button v-if="!ready" type="button" @click="loadProofs">もう一度読み込む</button>
    </div>
    <p v-if="!ready && !error" role="status">端末の保存を読み込んでいます。</p>
    <p v-if="busy" role="status">通信中です…</p>

    <section class="panel" aria-labelledby="stamp-congestion-title" :aria-busy="busy">
      <h2 id="stamp-congestion-title">混雑</h2>
      <div class="congestion choices">
        <button v-for="item in CONGESTION" :key="item.kind" type="button"
          class="congestion-button" :aria-label="item.label" :disabled="!canPress"
          :style="badgeStyle(item.kind)" @click="press(item.kind)">{{ item.number }}</button>
      </div>
      <p class="scale secondary"><span>空いている</span><span>とても混んでいる</span></p>
    </section>

    <section class="panel" aria-labelledby="stamp-feeling-title" :aria-busy="busy">
      <h2 id="stamp-feeling-title">感想</h2>
      <!-- D-022 / API-17。時刻は既存設定を参照し、押した後の残り時間は expiresAt から表示する。 -->
      <p class="secondary">感想のスタンプは、その日の閉場（{{ CLOSING_TIME }}）まで有効です。</p>
      <div class="feelings choices">
        <button v-for="item in FEELINGS" :key="item.kind" type="button" class="feeling-button"
          :aria-label="item.label" :disabled="!canPress" @click="press(item.kind)">
          <span class="feeling-mark" aria-hidden="true">{{ item.mark }}</span>{{ item.label }}
        </button>
      </div>
    </section>

    <div v-if="activeToast" class="panel toast" role="status">
      <p>{{ title(activeToast.kind) }}を足元に押しました</p>
      <button type="button" :disabled="busy" @click="retract(activeToast!)">取り消す</button>
    </div>

    <section v-if="owned.length" class="panel" aria-labelledby="my-stamps-title">
      <h2 id="my-stamps-title">自分が押したスタンプ</h2>
      <ul>
        <li v-for="stamp in visible" :key="stamp.id" class="my-stamp">
          <span class="badge" :style="badgeStyle(stamp.kind)">{{ title(stamp.kind) }}</span>
          <div class="stamp-time secondary">
            <time :datetime="stamp.pressedAt">{{ age(Date.parse(stamp.pressedAt)) }}</time>
            <p>{{ remaining(stamp) }}</p>
          </div>
          <button type="button" :disabled="busy" :aria-label="`${title(stamp.kind)}を取り消す`"
            @click="retract(stamp)">取り消す</button>
        </li>
      </ul>
      <button v-if="!expanded && owned.length > VISIBLE_COUNT" type="button" @click="expanded = true">
        ほか {{ owned.length - VISIBLE_COUNT }} 件を見る
      </button>
      <p class="secondary">この端末のデータが消えると、取り消せなくなります。</p>
    </section>
  </main>
</template>

<style scoped>
.stamp-view {
  box-sizing: border-box;
  min-height: 100dvh;
  padding: var(--stamp-space-4);
  background: var(--stamp-page);
  color: var(--stamp-text);
  font-family: var(--stamp-font);
  font-size: var(--stamp-body-size);
  font-weight: var(--stamp-body-weight);
  line-height: var(--stamp-body-leading);
}
header, .scale, .toast, .my-stamp { display: flex; align-items: center; justify-content: space-between; gap: var(--stamp-space-2); }
header { flex-wrap: wrap; margin-bottom: var(--stamp-space-4); }
h1, h2, p { margin: 0; }
h1, h2 { font-weight: var(--stamp-heading-weight); line-height: var(--stamp-heading-leading); }
h1 { font-size: var(--stamp-title-size); }
h2 { font-size: var(--stamp-heading-size); margin-bottom: var(--stamp-space-3); }
.panel, .error, .warning {
  margin-bottom: var(--stamp-space-4);
  padding: var(--stamp-space-4);
  border: 1px solid var(--stamp-border);
  border-radius: var(--stamp-radius);
  background: var(--stamp-surface);
}
.secondary { color: var(--stamp-secondary); }
.warning { color: var(--stamp-stale); }
.error { background: var(--stamp-danger-bg); color: var(--stamp-danger); }
button, a {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--stamp-target);
  padding: var(--stamp-space-2);
  color: var(--stamp-action);
  font: inherit;
  font-size: var(--stamp-action-size);
  font-weight: var(--stamp-action-weight);
  line-height: var(--stamp-action-leading);
  overflow-wrap: anywhere;
}
button { border: 1px solid var(--stamp-border); border-radius: var(--stamp-radius); background: var(--stamp-surface); cursor: pointer; }
button:disabled { opacity: var(--stamp-disabled); cursor: default; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--stamp-action); outline-offset: var(--stamp-space-1); }
button:active:not(:disabled) { box-shadow: inset 0 0 0 100vmax var(--stamp-pressed); }
.choices { display: grid; gap: var(--stamp-space-2); }
.congestion { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.congestion-button {
  min-height: calc(var(--stamp-target) + var(--stamp-space-2));
  border-color: var(--stamp-congestion-border);
  font-size: var(--stamp-title-size);
}
.scale { margin-top: var(--stamp-space-2); }
.feelings { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.feeling-button { flex-direction: column; gap: var(--stamp-space-1); padding: var(--stamp-space-3) 0; color: var(--stamp-text); }
.feeling-mark { padding: var(--stamp-space-1) var(--stamp-space-2); border-radius: var(--stamp-radius); background: var(--stamp-feeling); color: var(--stamp-feeling-on); }
ul { margin: 0; padding: 0; list-style: none; }
.my-stamp { flex-wrap: wrap; padding: var(--stamp-space-2) 0; border-top: 1px solid var(--stamp-border); }
.badge { padding: var(--stamp-space-1) var(--stamp-space-2); border-radius: var(--stamp-radius); font-weight: var(--stamp-action-weight); }
.stamp-time { flex: 1; }
</style>
