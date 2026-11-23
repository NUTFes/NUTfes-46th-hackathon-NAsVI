import { getCurrentScope, onScopeDispose, ref } from 'vue';
import type { Position } from '../types';

type PositionStatus = 'idle' | 'asking' | 'granted' | 'denied' | 'unavailable';

export function usePosition() {
  const position = ref<Position | null>(null);
  const status = ref<PositionStatus>('idle');
  let watch: { geolocation: Geolocation; id: number | null } | null = null;
  let visibilityDocument: Document | null = null;

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
            status.value = 'unavailable';
          }
        },
        { enableHighAccuracy: !hidden, maximumAge: hidden ? 60_000 : 0 },
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
    stopTracking();
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

  if (getCurrentScope()) onScopeDispose(stopTracking);

  return { position, status, allow, refuse, report, setManually };
}
