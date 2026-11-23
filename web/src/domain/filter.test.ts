import { describe, expect, it } from 'vitest';
import type { Place, FilterState } from '../types';
import { applyFilter, countByBuilding } from './filter';

function place(id: string, overrides: Partial<Place> = {}): Place {
  return {
    id,
    name: id,
    kind: 'event',
    location: { lat: 37.4252, lng: 138.7788 },
    description: '',
    landmarkId: 'building-a',
    floor: null,
    hours: [],
    labelIds: [],
    ...overrides,
  };
}

const places: Place[] = [
  place('food', { labelIds: ['food'] }),
  place('exhibit', { labelIds: ['exhibit'] }),
  place('both', { labelIds: ['food', 'exhibit'], landmarkId: 'building-b' }),
  place('unlabeled', { landmarkId: 'building-b' }),
  place('outdoor', { labelIds: ['food'], landmarkId: null }),
  place('parking', { kind: 'parking', labelIds: ['parking'], landmarkId: 'building-c' }),
];

const tagLinks = [
  { placeId: 'food', tagId: 'favorite' },
  { placeId: 'food', tagId: 'favorite' },
  { placeId: 'exhibit', tagId: 'want' },
  { placeId: 'both', tagId: 'favorite' },
  { placeId: 'both', tagId: 'want' },
  { placeId: 'unlabeled', tagId: 'favorite' },
  { placeId: 'unlabeled', tagId: 'want' },
  { placeId: 'outdoor', tagId: 'favorite' },
  { placeId: 'deleted-place', tagId: 'missing' },
];

interface FilterCase {
  name: string;
  state: FilterState;
  expectedIds: string[];
  expectedCounts: [string, number][];
}

const cases: FilterCase[] = [
  {
    name: '未選択なら種類もタグも絞らない',
    state: { labelIds: [], tagIds: [] },
    expectedIds: ['food', 'exhibit', 'both', 'unlabeled', 'outdoor', 'parking'],
    expectedCounts: [['building-a', 2], ['building-b', 2], ['building-c', 1]],
  },
  {
    name: '種類のみ: 選択した種類のどれかが付く場所を残す（OR）',
    state: { labelIds: ['food', 'exhibit'], tagIds: [] },
    expectedIds: ['food', 'exhibit', 'both', 'outdoor'],
    expectedCounts: [['building-a', 2], ['building-b', 1]],
  },
  {
    name: 'タグのみ: 選択したタグ全てが同じ場所に付く必要がある（AND）',
    state: { labelIds: [], tagIds: ['favorite', 'want'] },
    expectedIds: ['both', 'unlabeled'],
    expectedCounts: [['building-b', 2]],
  },
  {
    name: '併用: 種類の OR とタグの AND を共に満たす場所を残す',
    state: { labelIds: ['food', 'exhibit'], tagIds: ['favorite', 'want'] },
    expectedIds: ['both'],
    expectedCounts: [['building-b', 1]],
  },
  {
    name: 'タグ1つ: 種類のない場所もタグで選べ、屋外は建物件数に含めない',
    state: { labelIds: [], tagIds: ['favorite'] },
    expectedIds: ['food', 'both', 'unlabeled', 'outdoor'],
    expectedCounts: [['building-a', 1], ['building-b', 2]],
  },
  {
    name: '駐車場は設備の例外にせず絞り込み・集計する',
    state: { labelIds: ['parking'], tagIds: [] },
    expectedIds: ['parking'],
    expectedCounts: [['building-c', 1]],
  },
  {
    name: '0件: 一致する種類がなければ空を返す',
    state: { labelIds: ['missing'], tagIds: [] },
    expectedIds: [],
    expectedCounts: [],
  },
  {
    name: '0件: 別の場所のタグは一致に使わない',
    state: { labelIds: [], tagIds: ['missing'] },
    expectedIds: [],
    expectedCounts: [],
  },
  {
    name: '0件: 種類とタグが別々の場所で一致しても残さない',
    state: { labelIds: ['parking'], tagIds: ['favorite'] },
    expectedIds: [],
    expectedCounts: [],
  },
];

describe('applyFilter', () => {
  it.each(cases)('$name', ({ state, expectedIds }) => {
    expect(applyFilter(places, state, tagLinks).map(({ id }) => id)).toEqual(expectedIds);
  });
});

describe('countByBuilding', () => {
  it.each(cases)('$name', ({ state, expectedCounts }) => {
    expect(countByBuilding(places, state, tagLinks)).toEqual(new Map(expectedCounts));
  });
});

describe('設備と境界条件', () => {
  it.each(['info', 'wc', 'rest', 'trash'] as const)(
    '%s は条件に関係なく残し、条件に一致しても建物件数に含めない',
    (kind) => {
      const facility = place(kind, { kind, labelIds: ['facility'] });
      const links = [{ placeId: kind, tagId: 'favorite' }];
      for (const state of [
        { labelIds: [], tagIds: [] },
        { labelIds: ['missing'], tagIds: ['missing'] },
        { labelIds: ['facility'], tagIds: ['favorite'] },
      ]) {
        expect(applyFilter([facility], state, links)).toEqual([facility]);
        expect(countByBuilding([facility], state, links)).toEqual(new Map());
      }
    },
  );

  it.each<FilterState>([
    { labelIds: [], tagIds: [] },
    { labelIds: ['food'], tagIds: [] },
    { labelIds: [], tagIds: ['favorite'] },
  ])('tagLinks の省略は空配列と同じ: %o', (state) => {
    const expected = state.tagIds.length > 0 ? []
      : state.labelIds.length > 0 ? [places[0], places[2], places[4]] : places;
    expect(applyFilter(places, state)).toEqual(expected);
    expect(countByBuilding(places, state)).toEqual(
      state.tagIds.length > 0 ? new Map()
        : state.labelIds.length > 0
          ? new Map([['building-a', 1], ['building-b', 1]])
          : new Map([['building-a', 2], ['building-b', 2], ['building-c', 1]]),
    );
  });

  it.each<FilterState>([
    { labelIds: [], tagIds: [] },
    { labelIds: ['food'], tagIds: ['favorite'] },
  ])('場所が0件なら空を返す: %o', (state) => {
    expect(applyFilter([], state, tagLinks)).toEqual([]);
    expect(countByBuilding([], state, tagLinks)).toEqual(new Map());
  });

  it.each([applyFilter, countByBuilding])('%s は入力を変更しない', (filter) => {
    const input = structuredClone(places);
    const state: FilterState = { labelIds: ['food', 'exhibit'], tagIds: ['favorite'] };
    const links = structuredClone(tagLinks);
    const before = structuredClone({ input, state, links });
    filter(input, state, links);
    expect({ input, state, links }).toEqual(before);
  });
});
