import { getCurrentScope, onScopeDispose, ref } from 'vue';
import { getStorage, type MetaValue } from '../storage';

export type OrientationStatus = 'idle' | 'asking' | 'granted' | 'denied' | 'unavailable' | 'timeout';

export interface OrientationStorage {
  get(key: string): Promise<MetaValue | undefined>;
  save(key: string, value: MetaValue): Promise<void>;
}

type PermissionConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};
type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

const OFFSET_KEY = 'orientation.offset';
// 暫定: 実機で取得頻度・揺れを確認して調整する。
const TIMEOUT_MS = 15_000;
const SAMPLE_COUNT = 5;
const heading = ref<number | null>(null);
const offset = ref(0);
const status = ref<OrientationStatus>('idle');
const defaultStorage: OrientationStorage = {
  get: async (key) => (await getStorage()).meta.get(key),
  save: async (key, value) => (await getStorage()).meta.save(key, value),
};

let consumers = 0;
let session: {
  storage: OrientationStorage;
  revision: number;
  ready: Promise<void>;
  writes: Promise<void>;
} | null = null;
let tracking: {
  target: Window;
  document: Document;
  orientation?: ScreenOrientation;
  event: 'deviceorientation' | 'deviceorientationabsolute';
  listener: EventListener;
  screenListener: EventListener;
  visibilityListener: EventListener;
  active: boolean;
  timer?: ReturnType<typeof setTimeout>;
} | null = null;
let generation = 0;
let pending: Promise<void> | null = null;
let samples: number[] = [];
let smoothed: number | null = null;

function normalize(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}

function updateHeading() {
  const target = tracking?.target;
  const angle = target?.screen?.orientation?.angle;
  const legacyAngle = (target as (Window & { orientation?: number }) | undefined)?.orientation;
  const screenAngle = typeof angle === 'number' && Number.isFinite(angle) ? angle
    : typeof legacyAngle === 'number' && Number.isFinite(legacyAngle) ? legacyAngle : 0;
  heading.value = smoothed === null ? null : normalize(smoothed + screenAngle + offset.value);
}

function pauseTracking(current: NonNullable<typeof tracking>) {
  clearTimeout(current.timer);
  current.timer = undefined;
  if (current.active) {
    current.active = false;
    current.target.removeEventListener(current.event, current.listener);
    current.orientation?.removeEventListener('change', current.screenListener);
  }
  samples = [];
  smoothed = null;
  heading.value = null;
}

function stopTracking() {
  generation += 1;
  pending = null;
  const previous = tracking;
  tracking = null;
  if (previous) {
    pauseTracking(previous);
    previous.document.removeEventListener('visibilitychange', previous.visibilityListener);
  }
  samples = [];
  smoothed = null;
  heading.value = null;
}

function startTracking(target: Window, ios: boolean, token: number) {
  if (generation !== token) return;
  const current: NonNullable<typeof tracking> = {
    target,
    document: target.document,
    orientation: target.screen?.orientation,
    event: ios ? 'deviceorientation' : 'deviceorientationabsolute',
    active: false,
    screenListener: () => {
      if (tracking === current && current.active) updateHeading();
    },
    visibilityListener: () => {
      if (tracking !== current) return;
      if (current.document.visibilityState === 'hidden') pauseTracking(current);
      else resumeTracking();
    },
    listener: (event) => {
      if (tracking !== current || !current.active) return;
      const reading = event as CompassEvent;
      const compass = reading.webkitCompassHeading;
      const value = typeof compass === 'number' && Number.isFinite(compass)
        ? compass
        : !ios && reading.alpha !== null && Number.isFinite(reading.alpha)
          ? 360 - reading.alpha : null;
      if (value === null) return;

      samples.push(normalize(value));
      if (samples.length > SAMPLE_COUNT) samples.shift();
      const x = samples.reduce((sum, degrees) => sum + Math.cos(degrees * Math.PI / 180), 0);
      const y = samples.reduce((sum, degrees) => sum + Math.sin(degrees * Math.PI / 180), 0);
      // Opposing samples have no circular mean; retain the last usable heading.
      if (Math.hypot(x, y) > 1e-10) smoothed = normalize(Math.atan2(y, x) * 180 / Math.PI);
      updateHeading();
      status.value = 'granted';
      armTimeout();
    },
  };
  function armTimeout() {
    clearTimeout(current.timer);
    current.timer = setTimeout(() => {
      if (tracking !== current || !current.active) return;
      samples = [];
      smoothed = null;
      heading.value = null;
      status.value = 'timeout';
    }, TIMEOUT_MS);
  }
  function resumeTracking() {
    if (current.active || current.document.visibilityState === 'hidden') return;
    try {
      current.active = true;
      status.value = 'asking';
      target.addEventListener(current.event, current.listener);
      current.orientation?.addEventListener('change', current.screenListener);
      armTimeout();
    } catch {
      stopTracking();
      status.value = 'unavailable';
    }
  }
  tracking = current;
  try {
    current.document.addEventListener('visibilitychange', current.visibilityListener);
    resumeTracking();
  } catch {
    stopTracking();
    status.value = 'unavailable';
  }
}

// Call directly from a user gesture (e.g. a button click); never await storage first.
function allow(): Promise<void> {
  if (pending) return pending;
  if (tracking) return Promise.resolve();
  stopTracking();
  status.value = 'asking';
  const target = typeof window === 'undefined' ? undefined : window;
  const constructor = target?.DeviceOrientationEvent as PermissionConstructor | undefined;
  if (!target || !constructor) {
    status.value = 'unavailable';
    return Promise.resolve();
  }
  const token = generation;
  if (typeof constructor.requestPermission !== 'function') {
    startTracking(target, false, token);
    return Promise.resolve();
  }
  try {
    // Invoke synchronously to preserve iOS transient user activation and its receiver.
    const permission = constructor.requestPermission();
    const result = Promise.resolve(permission).then((value) => {
      if (generation !== token) return;
      if (value === 'granted') startTracking(target, true, token);
      else status.value = 'denied';
    }).catch((error: unknown) => {
      if (generation !== token) return;
      status.value = error instanceof Error && error.name === 'NotAllowedError'
        ? 'denied' : 'unavailable';
    }).finally(() => {
      if (pending === result) pending = null;
    });
    pending = result;
    return result;
  } catch (error) {
    status.value = error instanceof Error && error.name === 'NotAllowedError'
      ? 'denied' : 'unavailable';
    return Promise.resolve();
  }
}

function refuse() {
  stopTracking();
  status.value = 'denied';
}

/** The first consumer selects storage for the shared session; all consumers share calibration. */
export function useOrientation(storage: OrientationStorage = defaultStorage) {
  if (session === null) {
    const current = { storage, revision: 0, ready: Promise.resolve(), writes: Promise.resolve() };
    session = current;
    current.ready = Promise.resolve().then(() => storage.get(OFFSET_KEY)).then((value) => {
      if (session !== current || current.revision !== 0) return;
      if (typeof value === 'number' && Number.isFinite(value)) {
        offset.value = value;
        updateHeading();
      }
    }).catch(() => { /* Storage failure must not prevent in-memory orientation. */ });
  }
  const current = session;
  consumers += 1;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    consumers -= 1;
    if (consumers === 0) {
      stopTracking();
      session = null;
      offset.value = 0;
      status.value = 'idle';
    }
  }

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    heading,
    offset,
    status,
    ready: current.ready,
    allow: () => disposed ? Promise.resolve() : allow(),
    refuse: () => { if (!disposed) refuse(); },
    report: () => heading.value,
    // Resolves true only when persisted. Calibration still applies if saving fails.
    setOffset(degrees: number): Promise<boolean> {
      if (disposed || !Number.isFinite(degrees)) return Promise.resolve(false);
      current.revision += 1;
      offset.value = degrees;
      updateHeading();
      const write = current.writes.then(() => current.storage.save(OFFSET_KEY, degrees));
      current.writes = write.catch(() => {});
      return write.then(() => true, () => false);
    },
    dispose,
  };
}
