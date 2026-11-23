import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Label, Landmark, Place, Stamp } from '../types';
import {
  applyChange,
  useChangesStore,
  useLabelsStore,
  useLandmarksStore,
  usePlacesStore,
  useStampsStore,
} from './index';
import type { ChangeEvent, ChangeType } from './index';

const place: Place = {
  id: 'pl_01', name: '焼きそば屋台', kind: 'event',
  location: { lat: 37.4252, lng: 138.7788 }, description: '模擬店',
  landmarkId: 'lm_a', floor: 1,
  hours: [{ start: '2026-11-28T01:00:00Z', end: '2026-11-28T07:00:00Z' }],
  labelIds: ['lb_food'],
};
const updatedPlace: Place = {
  ...place, name: '屋外へ移動', description: '更新後',
  location: { lat: 37.4253, lng: 138.7789 },
  landmarkId: null, floor: null, hours: [], labelIds: [],
};
const stamp: Stamp = {
  id: 'st_01', kind: 'food', at: { lat: 37.4252, lng: 138.7788 },
  pressedAt: '2026-11-28T01:00:00Z', expiresAt: '2026-11-28T01:30:00Z',
};
const landmark: Landmark = {
  id: 'lm_a', name: 'A 棟', location: place.location, footprint: null, floors: [],
};
const label: Label = { id: 'lb_food', title: '飲食' };

beforeEach(() => {
  setActivePinia(createPinia());
  // 実装やテストが誤って外部通信を始めた場合もネットワークには出さない。
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('ストアからの通信は禁止'); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function snapshot(): string {
  const changes = useChangesStore();
  return JSON.stringify({
    places: usePlacesStore().items,
    stamps: useStampsStore().items,
    landmarks: useLandmarksStore().items,
    labels: useLabelsStore().items,
    version: changes.version,
    versionChanged: changes.versionChanged,
    appliedChangeIds: [...changes.appliedChangeIds],
  });
}

describe('一覧のストア', () => {
  it('4つの一覧は空で始まり、版の変更はない', () => {
    expect(usePlacesStore().items).toEqual([]);
    expect(useStampsStore().items).toEqual([]);
    expect(useLandmarksStore().items).toEqual([]);
    expect(useLabelsStore().items).toEqual([]);
    expect(useChangesStore().version).toBeNull();
    expect(useChangesStore().versionChanged).toBe(false);
  });

  const lists = [
    { name: 'places', store: () => usePlacesStore(), item: place },
    { name: 'stamps', store: () => useStampsStore(), item: stamp },
    { name: 'landmarks', store: () => useLandmarksStore(), item: landmark },
    { name: 'labels', store: () => useLabelsStore(), item: label },
  ] as const;

  // 各ストアの setAll の型を保ったまま、同じ置き換え操作を検査する。
  function checkReplacement<T>(store: { items: T[]; setAll(items: readonly T[]): void }, item: T) {
    store.setAll([item]);
    expect(store.items).toEqual([item]);
    const next: T[] = [item];
    store.setAll(next);
    expect(store.items).toEqual([item]);
    next.length = 0;
    expect(store.items).toEqual([item]);
    store.setAll([]);
    expect(store.items).toEqual([]);
  }

  it('places: setAll で置き換え、空にできる', () => {
    checkReplacement(usePlacesStore(), place);
  });
  it('stamps: setAll で置き換え、空にできる', () => {
    checkReplacement(useStampsStore(), stamp);
  });
  it('landmarks: setAll で置き換え、空にできる', () => {
    checkReplacement(useLandmarksStore(), landmark);
  });
  it('labels: setAll で置き換え、空にできる', () => {
    checkReplacement(useLabelsStore(), label);
  });

  it.each(lists)('$name: Pinia インスタンス間で一覧を共有しない', ({ store, item }) => {
    const first = store();
    // このテストはどの一覧でも空の状態を隔離できることを調べる。
    first.items.push(item as never);
    setActivePinia(createPinia());
    expect(store().items).toEqual([]);
    expect(first.items).toEqual([item]);
  });
});

describe.each([true, false])('applyChange: 出来事IDあり=%s', (withId) => {
  const cases: Array<{
    type: ChangeType;
    payload: unknown;
    expectedPlaces: Place[];
    expectedStamps: Stamp[];
  }> = [
    { type: 'stampPressed', payload: { ...stamp, id: 'st_02' }, expectedPlaces: [place], expectedStamps: [stamp, { ...stamp, id: 'st_02' }] },
    { type: 'stampRetracted', payload: { id: stamp.id }, expectedPlaces: [place], expectedStamps: [] },
    { type: 'placeAdded', payload: { ...place, id: 'pl_02' }, expectedPlaces: [place, { ...place, id: 'pl_02' }], expectedStamps: [stamp] },
    { type: 'placeUpdated', payload: updatedPlace, expectedPlaces: [updatedPlace], expectedStamps: [stamp] },
    { type: 'placeRemoved', payload: { id: place.id }, expectedPlaces: [], expectedStamps: [stamp] },
    { type: 'appVersionChanged', payload: { version: '2026-11-28.2' }, expectedPlaces: [place], expectedStamps: [stamp] },
  ];

  it.each(cases)('$type を適用し、2回目でも全ストアの結果が変わらない', (testCase) => {
    usePlacesStore().setAll([place]);
    useStampsStore().setAll([stamp]);
    useLandmarksStore().setAll([landmark]);
    useLabelsStore().setAll([label]);
    const event: ChangeEvent = {
      id: withId ? 121 : undefined, type: testCase.type, payload: testCase.payload,
    };

    applyChange(event);

    expect(usePlacesStore().items).toEqual(testCase.expectedPlaces);
    expect(useStampsStore().items).toEqual(testCase.expectedStamps);
    expect(useLandmarksStore().items).toEqual([landmark]);
    expect(useLabelsStore().items).toEqual([label]);
    expect(useChangesStore().version).toBe(testCase.type === 'appVersionChanged' ? '2026-11-28.2' : null);
    expect(useChangesStore().versionChanged).toBe(testCase.type === 'appVersionChanged');
    const once = snapshot();
    applyChange(event);
    expect(snapshot()).toBe(once);
  });

  it.each(['placeAdded', 'placeUpdated'] as const)('%s は同じ場所IDを置き換え、未取得の場所も追加できる', (type) => {
    usePlacesStore().setAll([place]);
    applyChange({ type, payload: updatedPlace });
    applyChange({ type, payload: { ...place, id: 'pl_new' } });
    expect(usePlacesStore().items).toEqual([updatedPlace, { ...place, id: 'pl_new' }]);
  });

  it('stampPressed は同じスタンプIDを重複させずに置き換える', () => {
    useStampsStore().setAll([stamp]);
    const updated: Stamp = { ...stamp, kind: 'fun' };
    applyChange({ type: 'stampPressed', payload: updated });
    expect(useStampsStore().items).toEqual([updated]);
  });

  it.each(['stampRetracted', 'placeRemoved'] as const)('%s は存在しないIDの削除でも他の項目を保つ', (type) => {
    usePlacesStore().setAll([place]);
    useStampsStore().setAll([stamp]);
    applyChange({ id: withId ? 122 : undefined, type, payload: { id: 'missing' } });
    applyChange({ type, payload: { id: 'missing' } });
    expect(usePlacesStore().items).toEqual([place]);
    expect(useStampsStore().items).toEqual([stamp]);
  });
});

describe('出来事の再配信と版の変更', () => {
  it('更新・削除の後に古い出来事が再配信されても巻き戻らない', () => {
    const events: ChangeEvent[] = [
      { id: 0, type: 'placeAdded', payload: place },
      { id: 1, type: 'placeUpdated', payload: updatedPlace },
      { id: 2, type: 'stampPressed', payload: stamp },
      { id: 3, type: 'stampRetracted', payload: { id: stamp.id } },
      { id: 4, type: 'placeRemoved', payload: { id: place.id } },
      { id: 5, type: 'appVersionChanged', payload: { version: 'v1' } },
      { id: 6, type: 'appVersionChanged', payload: { version: 'v2' } },
    ];
    events.forEach(applyChange);
    const once = snapshot();
    events.forEach(applyChange);
    expect(snapshot()).toBe(once);
    expect(usePlacesStore().items).toEqual([]);
    expect(useStampsStore().items).toEqual([]);
    expect(useChangesStore().version).toBe('v2');
  });

  it('版の変更通知を確認後、同じ版では再通知せず、新しい版で再び通知する', () => {
    applyChange({ id: 1, type: 'appVersionChanged', payload: { version: 'v1' } });
    const changes = useChangesStore();
    changes.acknowledgeVersionChange();
    applyChange({ id: 1, type: 'appVersionChanged', payload: { version: 'v1' } });
    applyChange({ id: 2, type: 'appVersionChanged', payload: { version: 'v1' } });
    applyChange({ type: 'appVersionChanged', payload: { version: 'v1' } });
    expect(changes.versionChanged).toBe(false);
    applyChange({ id: 3, type: 'appVersionChanged', payload: { version: 'v2' } });
    expect(changes.version).toBe('v2');
    expect(changes.versionChanged).toBe(true);
    applyChange({ id: 4, type: 'appVersionChanged', payload: { version: 'v2' } });
    expect(changes.versionChanged).toBe(true);
  });

  it('知らないtypeやresyncはpayloadを読まず、全状態を変更せずに無視する', () => {
    const before = snapshot();
    for (const type of ['unknown', 'resync']) {
      applyChange({ id: 9, type: type as ChangeType, payload: null });
    }
    expect(snapshot()).toBe(before);
    applyChange({ id: 9, type: 'placeAdded', payload: place });
    expect(usePlacesStore().items).toEqual([place]);
  });

  it('別の出来事を大きなIDを先に受けても捨てない（順序はsync層が管理する）', () => {
    applyChange({ id: 20, type: 'placeAdded', payload: place });
    applyChange({ id: 10, type: 'stampPressed', payload: stamp });
    expect(usePlacesStore().items).toEqual([place]);
    expect(useStampsStore().items).toEqual([stamp]);
  });

  it('出来事の重複記録と版もPiniaごとに独立し、actionは自分のPiniaに適用する', () => {
    const firstPinia = createPinia();
    const first = useChangesStore(firstPinia);
    const secondPinia = createPinia();
    const second = useChangesStore(secondPinia);
    const event = { id: 1, type: 'placeAdded', payload: place, createdAt: '2026-11-28T01:00:00Z' } as const;
    first.applyChange(event);
    first.applyChange({ id: 2, type: 'appVersionChanged', payload: { version: 'v1' } });
    expect(usePlacesStore(firstPinia).items).toEqual([place]);
    expect(usePlacesStore(secondPinia).items).toEqual([]);
    expect(second.version).toBeNull();
    expect(second.versionChanged).toBe(false);
    second.applyChange(event);
    expect(usePlacesStore(secondPinia).items).toEqual([place]);
  });
});

describe('有効なスタンプ', () => {
  const now = Date.parse('2026-11-28T01:30:00Z');

  it('固定時刻より前と同時刻の期限を除外し、未来の期限だけ返す', () => {
    const expired = { ...stamp, id: 'expired', expiresAt: '2026-11-28T01:29:59.999Z' };
    const active = { ...stamp, id: 'active', expiresAt: '2026-11-28T01:30:00.001Z' };
    const equivalentOffset = { ...stamp, id: 'offset', expiresAt: '2026-11-28T10:30:00+09:00' };
    const store = useStampsStore();
    store.setAll([expired, stamp, active, equivalentOffset]);
    expect(store.activeStamps(now)).toEqual([active]);
    expect(store.items).toEqual([expired, stamp, active, equivalentOffset]);
    expect(store.activeStamps(now + 1)).toEqual([]);
  });

  it('省略時の現在時刻を呼び出すたびに読み、時間経過で期限切れにする', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now - 1);
    const store = useStampsStore();
    store.setAll([stamp]);
    const activeStamps = store.activeStamps;
    expect(activeStamps()).toEqual([stamp]);
    vi.setSystemTime(now);
    expect(activeStamps()).toEqual([]);
  });

  it('追加・取り消し・一覧の置き換えを取得済みのgetterにも反映する', () => {
    const store = useStampsStore();
    const activeStamps = store.activeStamps;
    expect(activeStamps(now - 1)).toEqual([]);
    applyChange({ type: 'stampPressed', payload: stamp });
    expect(activeStamps(now - 1)).toEqual([stamp]);
    applyChange({ type: 'stampRetracted', payload: { id: stamp.id } });
    expect(activeStamps(now - 1)).toEqual([]);
    store.setAll([stamp]);
    expect(activeStamps(now - 1)).toEqual([stamp]);
    store.setAll([]);
    expect(activeStamps(now - 1)).toEqual([]);
  });
});

describe('レビュー対応', () => {
  it('削除のあとに届いた古い placeUpdated で場所が復活しない', () => {
    applyChange({ id: 1, type: 'placeAdded', payload: place });
    applyChange({ id: 3, type: 'placeRemoved', payload: { id: place.id } });
    applyChange({ id: 2, type: 'placeUpdated', payload: updatedPlace });
    expect(usePlacesStore().items).toEqual([]);
  });

  it('不正な payload は無視する', () => {
    const before = snapshot();
    applyChange({ type: 'stampPressed', payload: { id: 'x' } });
    applyChange({ type: 'stampRetracted', payload: null });
    applyChange({ type: 'placeAdded', payload: 'bad' });
    applyChange({ type: 'placeRemoved', payload: {} });
    applyChange({ type: 'appVersionChanged', payload: { version: 1 } });
    expect(snapshot()).toBe(before);
  });

  it('expiresAt が読めないスタンプは期限切れ扱い', () => {
    const store = useStampsStore();
    store.setAll([{ ...stamp, expiresAt: 'not-a-date' }]);
    expect(store.activeStamps(0)).toEqual([]);
  });

  it('適用済み id は上限つきで、reset で空になる', () => {
    const changes = useChangesStore();
    for (let i = 1; i <= 1005; i++) applyChange({ id: i, type: 'stampRetracted', payload: { id: 's' } });
    expect(changes.appliedChangeIds.size).toBe(1000);
    expect(changes.appliedChangeIds.has(1)).toBe(false);
    changes.resetAppliedChangeIds();
    expect(changes.appliedChangeIds.size).toBe(0);
  });
});
