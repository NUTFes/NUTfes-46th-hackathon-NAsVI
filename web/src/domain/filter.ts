import type { Place, FilterState } from '../types';

function isFacility(place: Place): boolean {
  return place.kind === 'info' || place.kind === 'wc'
    || place.kind === 'rest' || place.kind === 'trash';
}

/** 運営の種類は OR、自分用タグは AND。設備は常に残す。 */
export function applyFilter(
  places: ReadonlyArray<Place>,
  state: FilterState,
  tagLinks: ReadonlyArray<{ placeId: string; tagId: string }> = [],
): Place[] {
  const labels = new Set(state.labelIds);
  const tagsByPlace = new Map<string, Set<string>>();
  for (const { placeId, tagId } of tagLinks) {
    let tags = tagsByPlace.get(placeId);
    if (!tags) {
      tags = new Set<string>();
      tagsByPlace.set(placeId, tags);
    }
    tags.add(tagId);
  }

  return places.filter((place) => isFacility(place) || (
    (labels.size === 0 || place.labelIds.some((id) => labels.has(id)))
    && state.tagIds.every((id) => tagsByPlace.get(place.id)?.has(id))
  ));
}

/** 絞り込み後の場所を建物ごとに数える。設備と建物未所属の場所は除く。 */
export function countByBuilding(
  places: ReadonlyArray<Place>,
  state: FilterState,
  tagLinks: ReadonlyArray<{ placeId: string; tagId: string }> = [],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const place of applyFilter(places, state, tagLinks)) {
    if (isFacility(place) || place.landmarkId === null) continue;
    counts.set(place.landmarkId, (counts.get(place.landmarkId) ?? 0) + 1);
  }
  return counts;
}
