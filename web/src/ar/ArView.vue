<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { toXY } from '../domain/geo';
import { useOrientation, type OrientationStatus } from '../services/orientation';
import { usePosition } from '../services/position';
import type { Destination, Landmark, Place, Position } from '../types';
import BuildingCameraOverlay from '../components/ui/BuildingCameraOverlay.vue';
import { CAMERA_LABEL_CLASSES } from '../components/ui/CameraLabel.vue';
import { DEFAULT_LONG_FOV_DEG, describePlaces, describeTarget, pickFront, wrap180 } from './geometry';

// 決定根拠のない仮置き。PR #4 通常版由来の値で、実機での調整が必要。
const POSITION_ACCURACY_WARNING_M = 25;
const VENUE_DISTANCE_WARNING_M = 900;
const MAX_LABEL_AZIMUTH_DEG = 62;
const MAX_OCCLUDED_DISTANCE_M = 250;
const MAX_HIDDEN_LABELS = 3;
const DEFAULT_FOV_DEG = DEFAULT_LONG_FOV_DEG; // 65°。R-01 と同じ既定値。
const FOV_QUERY_PARAM = 'fov'; // ?fov による端末ごとの上書きも仮置き。
const MAX_FOV_DEG = 180;
const RAD = Math.PI / 180;
const MINI_SIZE = 240;
const MINI_RADIUS_M = 130;
const LABEL_GAP = 4; // space.1
const LABEL_STACK_GAP = 6; // space.1-5

// S-06 と同じ status ごとの案内。位置用コンポーネントから文言は公開されていない。
const ORIENTATION_HEADINGS: Record<OrientationStatus, string> = {
  idle: '向きの利用を選べます',
  asking: '向きの許可を確認しています',
  granted: '',
  denied: '向きの利用が許可されていません',
  unavailable: '向きを取得できません',
  timeout: '向きの取得に時間がかかっています',
};
const ORIENTATION_MESSAGES = {
  idle: '向きを利用すると、端末を向けた方向に企画を表示できます。',
  asking: '端末やブラウザの許可画面を確認してください。向きの取得を待っています。',
  granted: '',
  denied: '再依頼ボタンを押しても、許可画面が再表示されず反応がない場合があります。その場合は端末やブラウザの設定で許可を変更してください。',
  unavailable: '端末やブラウザが方位センサーに対応しているか確認し、HTTPS で開いてください。',
  timeout: '端末を動かして、もう一度試してください。',
  ios: 'iOS（Safari）: Safari の「モーションと画面の向きのアクセス」の設定が表示される場合は許可してください。拒否した場合は、このページを開き直して「向きの利用を許可」から再依頼してください。',
  android: 'Android（Chrome）: このサイトのアドレスバー左側→「権限」→「モーション センサー」で利用を許可してください。',
  settings: '設定の項目名は端末やバージョンによって異なります。変更後、このページに戻って再依頼してください。',
  fallback: '左右にドラッグして向きを合わせられます。地図・企画一覧も、このまま使えます。',
} as const;
const CAMERA_MESSAGES = {
  insecure: 'カメラを利用できません。HTTP ではカメラを使えないため、HTTPS で開いてください。方向と距離は表示できます。',
  unsupported: 'このブラウザはカメラの利用に対応していません。方向と距離は表示できます。',
  denied: 'カメラの利用が許可されていません。端末やブラウザの設定でカメラを許可してください。方向と距離は表示できます。',
  failed: 'カメラを起動できません。ほかのアプリで使用中でないか、端末やブラウザの設定を確認してください。方向と距離は表示できます。',
} as const;

const props = defineProps<{ places: Place[]; landmarks: Landmark[]; destination: Destination | null }>();
const emit = defineEmits<{ select: [id: string]; building: [id: string]; stop: [] }>();
const position = usePosition();
const orientation = useOrientation();
const root = ref<HTMLElement>();
const video = ref<HTMLVideoElement>();
const labels = ref<HTMLElement>();
const sensor = ref<HTMLElement>();
const warning = ref<HTMLElement>();
const front = ref<HTMLButtonElement>();
const frontName = ref<HTMLElement>();
const frontDetail = ref<HTMLElement>();
// 向きが分かるか(BuildingCameraOverlay の state)。切り替わるときだけ再描画する。
const headingState = ref<'recognized' | 'unknown'>('recognized');
const COMPASS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
const guide = ref<HTMLElement>();
const arrow = ref<HTMLElement>();
const guideText = ref<HTMLElement>();
const minimap = ref<HTMLCanvasElement>();
const started = ref(false);

// design-system/tokens.json の color.{dark,light}。
// design-system/claude-design/tokens.css と同じ解決済み値を使う。
const COLORS = {
  '--ar-bg': { dark: '#130a22', light: '#f6f4fa' }, // color.{dark,light}.bg-page
  '--ar-surface': { dark: '#1c1032', light: '#ffffff' }, // color.{dark,light}.bg-surface
  '--ar-text': { dark: '#f4f0ff', light: '#1e0b3a' }, // color.{dark,light}.text-primary
  '--ar-secondary': { dark: '#b4a9cf', light: '#5b5274' }, // color.{dark,light}.text-secondary
  '--ar-event': { dark: '#5eead4', light: '#0f766e' }, // color.{dark,light}.event
  '--ar-event-on': { dark: '#062a24', light: '#ffffff' }, // color.{dark,light}.event-on
  '--ar-facility': { dark: '#f4f0ff', light: '#1e0b3a' }, // color.{dark,light}.facility
  '--ar-facility-on': { dark: '#1e0b3a', light: '#ffffff' }, // color.{dark,light}.facility-on
  '--ar-border-subtle': { dark: '#a78bfa47', light: '#1e0b3a26' }, // color.{dark,light}.border-subtle(alpha 0.28 / 0.15)
  '--ar-destination-border': { dark: '#ffd84a', light: '#1e0b3a' }, // color.{dark,light}.destination-border
  '--ar-destination': { dark: '#ffd84a', light: '#facc15' }, // color.{dark,light}.destination
  '--ar-destination-on': { dark: '#1e0b3a', light: '#1e0b3a' }, // color.{dark,light}.destination-on
  '--ar-danger': { dark: '#f87171', light: '#dc2626' }, // color.{dark,light}.danger
  '--ar-danger-bg': { dark: '#2d1520', light: '#fef2f2' }, // color.{dark,light}.danger-bg
  '--ar-danger-text': { dark: '#fecaca', light: '#b91c1c' }, // color.{dark,light}.danger-text
  '--ar-action': { dark: '#a78bfa', light: '#6d28d9' }, // color.{dark,light}.action-primary
  '--ar-action-on': { dark: '#1e0b3a', light: '#ffffff' }, // color.{dark,light}.action-on-primary
  '--ar-action-selected': { dark: '#a78bfa38', light: '#ede9fe' }, // color.{dark,light}.action-selected-bg
} as const;
const TOKENS = {
  '--ar-space-1': '4px', // space.1
  '--ar-space-2': '8px', // space.2
  '--ar-space-3': '12px', // space.3
  '--ar-space-4': '16px', // space.4
  '--ar-font': '"Noto Sans JP", sans-serif', // font.family.base
  '--ar-body': '13px', // font.size.sm
  '--ar-heading': '16px', // font.size.xl
  '--ar-bold': '700', // font.weight.bold
  '--ar-radius': '12px', // radius.lg
  '--ar-touch': '44px', // size.touch-target
  '--ar-body-leading': '1.5', // claude-design/tokens.json type.groups body.lineHeight
} as const;
const theme = ref<'dark' | 'light'>('dark');
const colors = computed(() => Object.fromEntries(
  Object.entries(COLORS).map(([name, values]) => [name, values[theme.value]]),
));
function resolveColors() {
  theme.value = root.value?.closest('[data-theme]')?.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
let disposed = false;
let inViewport = true;
let frame: number | null = null;
let stream: MediaStream | null = null;
let cameraPending = false;
let cameraMessage = '';
let frontId: string | null = null;
let manualHeading = 0;
let drag: { x: number; base: number; offset: number; delta: number } | null = null;
let focal = 600;
let cleanup = () => {};
let resizeObserver: ResizeObserver | undefined;
const viewportSize = { width: 0, height: 0 };
const labelSizes = new Map<Element, { width: number; height: number }>();
const labelNodes = new Map<string, { button: HTMLButtonElement; meta: HTMLElement }>();
const visible = () => !disposed && started.value && !document.hidden && inViewport;
const text = (element: HTMLElement | undefined, value: string) => {
  if (element && element.textContent !== value) element.textContent = value;
};
const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;
const distance = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

function releaseCamera() {
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  if (video.value) video.value.srcObject = null;
}
async function openCamera() {
  if (!visible() || stream || cameraPending) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraMessage = window.isSecureContext === false || location.protocol === 'http:'
      ? CAMERA_MESSAGES.insecure : CAMERA_MESSAGES.unsupported;
    return;
  }
  cameraPending = true;
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    if (!visible()) acquired.getTracks().forEach(track => track.stop());
    else {
      stream = acquired;
      video.value!.srcObject = acquired;
      cameraMessage = '';
    }
  } catch (error) {
    cameraMessage = error instanceof Error && error.name === 'NotAllowedError'
      ? CAMERA_MESSAGES.denied : CAMERA_MESSAGES.failed;
  } finally {
    cameraPending = false;
  }
}
function start() {
  // iOS の許可要求をクリックから同期的に呼ぶ。保存の読み込みは待たない。
  void orientation.allow();
  position.allow();
  started.value = true;
  syncVisibility();
}
function requestOrientation() {
  if (orientation.status.value === 'timeout' || orientation.status.value === 'unavailable') orientation.refuse();
  void orientation.allow();
}
function syncVisibility() {
  if (visible()) {
    void openCamera();
    if (frame === null) frame = requestAnimationFrame(draw);
  } else {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    drag = null;
    releaseCamera();
  }
}
function syncLabels() {
  const events = props.places.filter(place => place.kind === 'event');
  const ids = new Set(events.map(place => place.id));
  for (const [id, node] of labelNodes) {
    if (!ids.has(id)) {
      resizeObserver?.unobserve(node.button);
      labelSizes.delete(node.button);
      node.button.remove();
      labelNodes.delete(id);
    }
  }
  for (const place of events) {
    let node = labelNodes.get(place.id);
    if (!node) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ar-label ${CAMERA_LABEL_CLASSES.base}`;
      button.dataset.placeId = place.id;
      const title = document.createElement('span');
      title.className = CAMERA_LABEL_CLASSES.name;
      const meta = document.createElement('span');
      meta.className = CAMERA_LABEL_CLASSES.meta;
      button.append(title, meta);
      button.addEventListener('click', () => emit('select', place.id));
      labels.value!.append(button);
      node = { button, meta };
      labelNodes.set(place.id, node);
      labelSizes.set(button, { width: Number.parseFloat(TOKENS['--ar-touch']), height: Number.parseFloat(TOKENS['--ar-touch']) });
      resizeObserver?.observe(button, { box: 'border-box' });
    }
    text(node.button.firstElementChild as HTMLElement, place.name);
    node.button.hidden = true;
  }
  return events;
}
function draw() {
  frame = null;
  if (!visible()) return;
  const { width: W, height: H } = viewportSize;
  if (W <= 0 || H <= 0) {
    frame = requestAnimationFrame(draw);
    return;
  }
  // PR #4 のラベル領域と size.touch-target から表示可能数を求める(P1 の上限制御)。
  const labelTop = 150;
  const labelBottom = H - 130;
  const maxLabels = Math.max(1, Math.floor((labelBottom - labelTop) / Number.parseFloat(TOKENS['--ar-touch'])));
  const vw = video.value!.videoWidth || W;
  const vh = video.value!.videoHeight || H;
  const fovParam = Number(new URLSearchParams(location.search).get(FOV_QUERY_PARAM));
  const fov = fovParam > 0 && fovParam < MAX_FOV_DEG ? fovParam : DEFAULT_FOV_DEG;
  if (W > 0 && H > 0) focal = Math.max(vw, vh) * Math.max(W / vw, H / vh) / 2 / Math.tan(fov / 2 * RAD);
  const events = syncLabels();
  const pos = position.report();
  const sensed = orientation.report();
  if (sensed !== null) manualHeading = sensed;
  const heading = sensed === null ? manualHeading : sensed - (drag?.delta ?? 0);
  const usable = pos !== null && Number.isFinite(pos.lat) && Number.isFinite(pos.lng);
  const nextState = sensed === null ? 'unknown' : 'recognized';
  if (headingState.value !== nextState) headingState.value = nextState;
  text(sensor.value, usable ? `現在地 ±${Number.isFinite(pos.accuracy) ? Math.round(pos.accuracy) : '不明'} m・${
    sensed === null ? '向きが分かりません' : `${COMPASS[Math.round(wrap360(sensed) / 45) % 8]}を向いています`}` :
    position.status.value === 'denied' ? '位置情報を許可してください' : '現在地を確認中');
  const far = usable && Math.hypot(...toXY(pos.lat, pos.lng)) > VENUE_DISTANCE_WARNING_M;
  text(warning.value, [cameraMessage, far ? '会場から離れています。方向と距離のみ表示します。' :
    usable && pos.accuracy > POSITION_ACCURACY_WARNING_M ? '位置の誤差が大きいです。屋外の開けた場所で確認してください。' : ''].filter(Boolean).join(' '));
  warning.value!.hidden = !warning.value!.textContent;
  frontId = null;
  guide.value!.hidden = true;
  const ctx = minimap.value!.getContext('2d');
  ctx?.clearRect(0, 0, MINI_SIZE, MINI_SIZE);
  if (usable) {
    // この版は正面の建物の有無による 2 状態。recognized-low の閾値は未決。
    const hit = pickFront(pos, heading, props.landmarks);
    frontId = hit?.building.id ?? null;
    const buildingEvents = events.filter(place => place.landmarkId === frontId);
    // 見た目は Figma の丸薬(正面: 建物名)。距離と企画は読み上げ用に残す。
    text(frontName.value, hit ? `正面: ${hit.building.name}` : '周囲の建物へカメラを向けてください');
    text(frontDetail.value, hit ? ` ${distance(hit.distance)}。${
      buildingEvents.length ? buildingEvents.map(place => place.name).join('、') : 'この建物には企画がありません'}` : '');
    const descriptions = describePlaces(pos, events, props.landmarks).sort((a, b) =>
      Number(b.place.id === props.destination?.placeId) - Number(a.place.id === props.destination?.placeId)
      || a.distance - b.distance);
    let shown = 0;
    let hiddenShown = 0;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const item of descriptions) {
      const { button, meta } = labelNodes.get(item.place.id)!;
      const isDestination = item.place.id === props.destination?.placeId;
      const d = item.nearD ?? item.distance;
      const c = wrap180(item.bearing - heading);
      const span = item.span ?? [0, 0];
      const margin = Math.min(4, (span[1] - span[0]) / 2);
      const azimuth = Math.max(c + span[0] + margin, Math.min(c + span[1] - margin, 0));
      if (!Number.isFinite(d) || Math.abs(azimuth) > MAX_LABEL_AZIMUTH_DEG || (item.place.landmarkId === null && d < 20)
        || shown >= maxLabels || (!isDestination && item.occluded && (d > MAX_OCCLUDED_DISTANCE_M || hiddenShown >= MAX_HIDDEN_LABELS))) continue;
      if (item.occluded && !isDestination) hiddenShown++;
      shown++;
      button.hidden = false;
      button.classList.toggle('ar-label--far', item.occluded && !isDestination);
      button.classList.toggle('ar-label--destination', isDestination);
      button.classList.toggle(CAMERA_LABEL_CLASSES.far, item.occluded && !isDestination);
      button.classList.toggle(CAMERA_LABEL_CLASSES.destination, isDestination);
      text(meta, `${distance(d)}${item.occluded ? ' · 建物の奥' : ''}`);
      const x = W / 2 + focal * Math.tan(azimuth * RAD);
      const { width: w, height: h } = labelSizes.get(button)!;
      let y = Math.max(labelTop + h, Math.min(labelBottom, H / 2 - focal * Math.tan(Math.max(3, Math.min(28, Math.atan(10 / d) / RAD)) * RAD)));
      for (let i = 0; i < 6; i++) {
        const overlap = placed.find(other => Math.abs(other.x - x) < (other.w + w) / 2 + LABEL_GAP && y > other.y - other.h - LABEL_GAP && y - h < other.y + LABEL_GAP);
        if (!overlap) break;
        y = overlap.y - overlap.h - LABEL_STACK_GAP;
      }
      placed.push({ x, y, w, h });
      button.style.transform = `translate(${x - w / 2}px, ${y - h}px)`;
    }
    const destination = props.places.find(place => place.id === props.destination?.placeId);
    if (destination) {
      // D-003: 行き先の登録座標までの直線の方角・距離。
      const target = describeTarget(pos, destination.location);
      guide.value!.hidden = false;
      arrow.value!.style.transform = `rotate(${wrap180(target.bearing - heading)}deg)`;
      text(guideText.value, `${destination.name}まで ${distance(target.distance)}`);
    }
    if (ctx) drawMinimap(ctx, pos, heading, W);
  } else {
    text(frontName.value, '現在地を確認すると正面の建物を表示します');
    text(frontDetail.value, '');
  }
  front.value!.disabled = frontId === null;
  frame = requestAnimationFrame(draw);
}
function drawMinimap(ctx: CanvasRenderingContext2D, pos: Position, heading: number, width: number) {
  const color = (name: string) => colors.value[`--ar-${name}`];
  const center = MINI_SIZE / 2;
  const k = center / MINI_RADIUS_M;
  const [ox, oy] = toXY(pos.lat, pos.lng);
  const c = Math.cos(heading * RAD), s = Math.sin(heading * RAD);
  const project = (location: Place['location']) => {
    const [x, y] = toXY(location.lat, location.lng);
    return [center + ((x - ox) * c - (y - oy) * s) * k, center - ((x - ox) * s + (y - oy) * c) * k] as const;
  };
  const destination = props.places.find(place => place.id === props.destination?.placeId);
  ctx.save();
  ctx.fillStyle = color('surface'); ctx.fillRect(0, 0, MINI_SIZE, MINI_SIZE);
  const half = Math.atan(width / 2 / focal);
  ctx.fillStyle = color('action-selected');
  ctx.beginPath(); ctx.moveTo(center, center); ctx.arc(center, center, MINI_SIZE, -Math.PI / 2 - half, -Math.PI / 2 + half); ctx.fill();
  ctx.globalAlpha = 1;
  for (const building of props.landmarks) {
    if (!building.footprint?.length) continue;
    ctx.beginPath();
    building.footprint.forEach((point, index) => { const [x, y] = project(point); if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
    // Figma: 建物は輪郭線(企画あり=mint、行き先=黄、他=violet)。
    ctx.strokeStyle = color(destination?.landmarkId === building.id ? 'destination' :
      props.places.some(place => place.kind === 'event' && place.landmarkId === building.id) ? 'event' : 'action');
    ctx.lineWidth = 5; ctx.stroke();
  }
  for (const place of props.places.filter(place => place.kind === 'event' && place.landmarkId === null)) {
    const [x, y] = project(place.location);
    ctx.fillStyle = color(place.id === props.destination?.placeId ? 'destination' : 'event');
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
  }
  if (destination) {
    const [x, y] = project(destination.location);
    ctx.strokeStyle = color('destination'); ctx.lineWidth = 4; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(center, center); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = color('text');
  ctx.beginPath(); ctx.arc(center, center, 9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function pointerDown(event: PointerEvent) {
  if (event.target !== labels.value || !visible()) return;
  drag = { x: event.clientX, base: orientation.report() ?? manualHeading, offset: orientation.offset.value, delta: 0 };
  labels.value!.setPointerCapture?.(event.pointerId);
}
function pointerMove(event: PointerEvent) {
  if (!drag) return;
  const delta = Math.atan((event.clientX - drag.x) / focal) / RAD;
  drag.delta = delta;
  if (orientation.report() === null) manualHeading = (drag.base - delta + 360) % 360;
}
function pointerUp() {
  if (drag && orientation.report() !== null) void orientation.setOffset(wrap180(drag.offset - drag.delta));
  drag = null;
}
onMounted(() => {
  resolveColors();
  const themeObserver = new MutationObserver(resolveColors);
  // 最寄りのテーマの変更・追加・削除を追い、コンテンツの更新は監視しない。
  for (let element = root.value; element; element = element.parentElement ?? undefined) {
    themeObserver.observe(element, { attributes: true, attributeFilter: ['data-theme'] });
  }
  resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const box = entry.borderBoxSize[0];
      const size = { width: box?.inlineSize ?? entry.contentRect.width, height: box?.blockSize ?? entry.contentRect.height };
      if (entry.target === root.value) Object.assign(viewportSize, size);
      // hidden による 0 は捨て、次に表示するときも直近の寸法を使う。
      else if (size.width > 0 && size.height > 0 && labelSizes.has(entry.target)) labelSizes.set(entry.target, size);
    }
  });
  resizeObserver.observe(root.value!, { box: 'border-box' });
  const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
    inViewport = entries.some(entry => entry.isIntersecting);
    syncVisibility();
  });
  observer?.observe(root.value!);
  document.addEventListener('visibilitychange', syncVisibility);
  cleanup = () => {
    observer?.disconnect();
    resizeObserver?.disconnect();
    themeObserver.disconnect();
    document.removeEventListener('visibilitychange', syncVisibility);
  };
});
onBeforeUnmount(() => {
  disposed = true;
  syncVisibility();
  cleanup();
  labelSizes.clear();
  labelNodes.clear();
  // 既存サービスの onScopeDispose が購読を解放する。
});
</script>

<template>
  <main ref="root" class="ar-view" :style="{ ...TOKENS, ...colors }" aria-label="カメラ">
    <video ref="video" autoplay muted playsinline aria-hidden="true" />
    <!-- このコンテナの子とフレームの表示内容は Vue の描画に載せない。 -->
    <div ref="labels" class="ar-labels" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="drag = null" @lostpointercapture="drag = null" />
    <BuildingCameraOverlay :state="headingState" hint="左右にドラッグして向きを合わせる">
      <template #status><span ref="sensor" /></template>
      <template #front>
        <div role="status">
          <button ref="front" class="ar-front" type="button" disabled @click="frontId && emit('building', frontId)">
            <span ref="frontName" /><span ref="frontDetail" class="ar-sr" />
          </button>
        </div>
      </template>
      <template #minimap>
        <canvas ref="minimap" class="ar-minimap" :width="MINI_SIZE" :height="MINI_SIZE" role="img" aria-label="現在地を中心に向いている方向を上にした周辺のミニマップ" />
      </template>
    </BuildingCameraOverlay>
    <div class="ar-top">
      <p ref="warning" class="ar-warning" hidden role="status" />
      <slot v-if="started && position.status.value === 'denied'" name="location-help" />
      <div class="ar-orientation" role="status" aria-live="polite" aria-atomic="true">
        <section v-if="started && orientation.status.value !== 'granted'">
          <h2>{{ ORIENTATION_HEADINGS[orientation.status.value] }}</h2>
          <p>{{ ORIENTATION_MESSAGES[orientation.status.value] }}</p>
          <template v-if="orientation.status.value === 'denied'">
            <p>{{ ORIENTATION_MESSAGES.ios }}</p>
            <p>{{ ORIENTATION_MESSAGES.android }}</p>
            <p>{{ ORIENTATION_MESSAGES.settings }}</p>
          </template>
          <p>{{ ORIENTATION_MESSAGES.fallback }}</p>
          <button type="button" :disabled="orientation.status.value === 'asking'" @click="requestOrientation">
            {{ orientation.status.value === 'asking' ? '確認中…' : orientation.status.value === 'timeout' || orientation.status.value === 'unavailable' ? 'もう一度試す' : '向きの利用を許可' }}
          </button>
        </section>
      </div>
    </div>
    <div class="ar-bottom">
      <div ref="guide" class="ar-guide" hidden>
        <span ref="arrow" aria-hidden="true">↑</span><span ref="guideText" />
        <button type="button" @click="emit('stop')">やめる</button>
      </div>
      <slot />
    </div>
    <section v-if="!started" class="ar-start">
      <h1>カメラ</h1>
      <p>周囲の建物にカメラを向けると、企画の方向と距離が分かります。</p>
      <p>カメラ・位置情報・向きの利用を許可してください。映像と位置・向きは端末内で処理し、送信しません。</p>
      <button type="button" @click="start">カメラを起動</button>
      <slot name="fallback" />
    </section>
  </main>
</template>

<style>
.ar-view { position: absolute; inset: 0; width: 100%; height: 100%; /* 下のタブを覆わないよう、visitor-stage の中に収める */ overflow: hidden; background: var(--ar-bg); color: var(--ar-text); font-family: var(--ar-font); font-size: var(--ar-body); line-height: var(--ar-body-leading); }
.ar-view [hidden] { display: none !important; }
.ar-view video, .ar-labels { position: absolute; inset: 0; width: 100%; height: 100%; }
.ar-view video { object-fit: cover; }
.ar-labels { overflow: hidden; touch-action: none; }
.ar-top { position: absolute; top: calc(env(safe-area-inset-top) + 46px); left: 0; right: 35%; max-height: 50%; overflow: auto; padding: var(--ar-space-2) var(--ar-space-3); }
.ar-top p { margin: 0 0 var(--ar-space-2); padding: var(--ar-space-2); background: var(--ar-surface); border-radius: var(--ar-radius); }
.ar-top .ar-warning { border: 1px solid var(--ar-danger); background: var(--ar-danger-bg); color: var(--ar-danger-text); }
.ar-orientation section { padding: var(--ar-space-2); border: 1px solid var(--ar-danger); border-radius: var(--ar-radius); background: var(--ar-danger-bg); color: var(--ar-danger-text); }
.ar-orientation p { padding: 0; background: transparent; }
.ar-orientation h2 { margin: 0 0 var(--ar-space-2); color: var(--ar-text); font-size: var(--ar-heading); font-weight: var(--ar-bold); }
.ar-orientation button { background: var(--ar-action); color: var(--ar-action-on); }
.ar-minimap { display: block; width: 100%; height: 100%; }
.ar-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.ar-bottom { position: absolute; bottom: 0; left: 0; right: 0; display: grid; gap: var(--ar-space-2); padding: var(--ar-space-3); }
.ar-view button, .ar-view a { box-sizing: border-box; min-height: var(--ar-touch); padding: var(--ar-space-2) var(--ar-space-3); border: 0; border-radius: var(--ar-radius); font: inherit; cursor: pointer; }
.ar-view a { display: inline-flex; align-items: center; color: var(--ar-text); background: var(--ar-surface); }
.ar-view .ar-front { width: auto; min-height: 0; padding: 6px 12px; border-radius: var(--ar-space-2); white-space: nowrap; font-size: 13px; font-weight: var(--ar-bold); line-height: 1; color: var(--ar-event-on); background: var(--ar-event); pointer-events: auto; }
.ar-view .ar-front:disabled { color: var(--ar-text); background: var(--ar-surface); box-shadow: inset 0 0 0 1px var(--ar-border-subtle); opacity: 1 !important; }
.ar-guide { display: flex; align-items: center; gap: var(--ar-space-2); padding: var(--ar-space-2); border-radius: var(--ar-radius); background: var(--ar-destination); color: var(--ar-destination-on); }
.ar-guide span:nth-child(2) { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ar-guide button { background: var(--ar-destination-on); color: var(--ar-destination); }
.ar-start { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: var(--ar-space-4); padding: var(--ar-space-4); background: var(--ar-bg); }
.ar-start h1 { font-size: var(--ar-heading); font-weight: var(--ar-bold); }
.ar-start button { background: var(--ar-action); color: var(--ar-action-on); }
.ar-view :focus-visible { outline: var(--ar-space-1) solid var(--ar-action); }
</style>
