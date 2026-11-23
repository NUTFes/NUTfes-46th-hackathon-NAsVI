import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { Position } from '../types';

type PositionStatus = 'idle' | 'asking' | 'granted' | 'denied' | 'unavailable' | 'timeout';

// 暫定: 実環境での取得状況を確認して調整する。
const POSITION_TIMEOUT_MS = 15_000;

const position = ref<Position | null>(null);
const status = ref<PositionStatus>('idle');
let watch: { geolocation: Geolocation; id: number | null } | null = null;
let visibilityDocument: Document | null = null;
let consumers = 0;

function stopWatch() {
  const previous = watch;
  // Invalidate callbacks before clearing: an already queued update may still arrive.
  watch = null;
  if (previous !== null && previous.id !== null) {
    previous.geolocation.clearWatch(previous.id);
  }
}

function stopTracking() {
  stopWatch();
  visibilityDocument?.removeEventListener('visibilitychange', startWatch);
  visibilityDocument = null;
}

function startWatch() {
  stopWatch();
  // Resolve at call time, including when a visibility change restarts the watch.
  const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
  if (!geolocation) {
    stopTracking();
    position.value = null;
    status.value = 'unavailable';
    return;
  }

  const current = { geolocation, id: null as number | null };
  watch = current;
  const hidden = visibilityDocument?.visibilityState === 'hidden';

  try {
    const id = geolocation.watchPosition(
      (result) => {
        if (watch !== current) return;
        position.value = {
          lat: result.coords.latitude,
          lng: result.coords.longitude,
          accuracy: result.coords.accuracy,
          takenAt: result.timestamp,
        };
        status.value = 'granted';
      },
      (error) => {
        if (watch !== current) return;
        position.value = null;
        if (error.code === 1) { // PERMISSION_DENIED
          stopTracking();
          status.value = 'denied';
        } else {
          // A temporary failure can recover on the same watch.
          status.value = error.code === 3 ? 'timeout' : 'unavailable';
        }
      },
      {
        enableHighAccuracy: !hidden,
        maximumAge: hidden ? 60_000 : 0,
        timeout: POSITION_TIMEOUT_MS,
      },
    );
    current.id = id;
    // Also handle implementations that invoke the error callback synchronously.
    if (watch !== current) geolocation.clearWatch(id);
  } catch {
    if (watch !== current) return;
    stopTracking();
    position.value = null;
    status.value = 'unavailable';
  }
}

function allow() {
  if (watch !== null) return;
  position.value = null;
  status.value = 'asking';
  visibilityDocument = typeof document === 'undefined' ? null : document;
  visibilityDocument?.addEventListener('visibilitychange', startWatch);
  startWatch();
}

function refuse() {
  stopTracking();
  position.value = null;
  status.value = 'denied';
}

function report(): Position | null {
  return position.value;
}

// An omitted accuracy is unknown; do not imply a perfectly accurate manual fix.
function setManually(lat: number, lng: number, accuracy = Infinity) {
  stopTracking();
  position.value = { lat, lng, accuracy, takenAt: Date.now() };
  status.value = 'granted';
}

export function usePosition() {
  consumers += 1;
  let disposed = false;

  // Scope 外の利用者は dispose() を明示的に呼んで参照を解放する。
  function dispose() {
    if (disposed) return;
    disposed = true;
    consumers -= 1;
    if (consumers === 0) {
      stopTracking();
      position.value = null;
      status.value = 'idle';
    }
  }

  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    position,
    status,
    allow: () => { if (!disposed) allow(); },
    refuse: () => { if (!disposed) refuse(); },
    report,
    setManually: (lat: number, lng: number, accuracy = Infinity) => {
      if (!disposed) setManually(lat, lng, accuracy);
    },
    dispose,
  };
}
