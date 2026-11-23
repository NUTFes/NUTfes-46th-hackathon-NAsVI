import { apiGet } from '../api/client';
import { loadSnapshot, pickCursor, saveSnapshot, type Snapshot } from './cache';

/** 初回と resync 時に一覧を取り直す。取得・保存の失敗は呼び出し元へ返す。 */
export async function bootstrap(): Promise<Snapshot> {
  const [places, stamps, landmarks, labels] = await Promise.all([
    apiGet('/places'),
    apiGet('/stamps'),
    apiGet('/landmarks'),
    apiGet('/labels'),
  ]);
  const snapshot: Snapshot = {
    places: places.items,
    stamps: stamps.items,
    landmarks: landmarks.items,
    labels: labels.items,
    cursor: pickCursor(places.cursor, stamps.cursor),
  };
  await saveSnapshot(snapshot);
  return snapshot;
}

export async function loadCachedOrFetch(): Promise<Snapshot> {
  return (await loadSnapshot()) ?? bootstrap();
}
