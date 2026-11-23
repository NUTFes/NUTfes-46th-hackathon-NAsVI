export interface ApiConfig {
  CONGESTION_TTL_MIN: number;
  /** Venue local time (Asia/Tokyo). The event date is supplied by the caller. */
  CLOSING_TIME: string;
  ORIGIN: { lat: number; lng: number };
  VENUE_BOUNDS: { north: number; south: number; east: number; west: number };
}

// Provisional values from contracts.md; venue bounds still need confirmation.
export let CONGESTION_TTL_MIN = 30;
export let CLOSING_TIME = '16:00';
export let ORIGIN = { lat: 37.4252, lng: 138.7788 };
export let VENUE_BOUNDS = { north: 37.4302, south: 37.4202, east: 138.7888, west: 138.7688 };

/** Tests may save the current values, override them, and restore them afterward. */
export function configureConfig(overrides: Partial<ApiConfig>): void {
  if (overrides.CONGESTION_TTL_MIN !== undefined) CONGESTION_TTL_MIN = overrides.CONGESTION_TTL_MIN;
  if (overrides.CLOSING_TIME !== undefined) CLOSING_TIME = overrides.CLOSING_TIME;
  if (overrides.ORIGIN !== undefined) ORIGIN = { ...overrides.ORIGIN };
  if (overrides.VENUE_BOUNDS !== undefined) VENUE_BOUNDS = { ...overrides.VENUE_BOUNDS };
}
