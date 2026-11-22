# 部品の props と API の項目の照合(ステップ 4)

作成: 2026-11-22 / 対象: `components/` の 34 部品と、API 設計(#15 の引き継ぎの表。ゲート 1 は未承認)
API の項目名は #15 のリソース案(places・stamps・landmarks)。OpenAPI はまだ無いので、項目名は仮。

## 食い違い・要確認(API 設計の台帳 `concept-design/api/review-ledger.yaml` に載せる候補)

| # | 部品 | props | API 側 | 食い違い | 誰が決めるか |
|---|---|---|---|---|---|
| 1 | PlaceRow・PlaceCard | placeId | places.id | **会期中に変わらないこと**を API 側に求める(端末のタグが id で覚える。#17) | API 設計 |
| 2 | PlaceRow・PlaceCard | building・floor | places の建物・階 | 概念 Place に「建物と階」が無い(※) | 概念設計 → API 設計 |
| 3 | PlaceCard | hours(開催時間) | なし | 概念 Place に時間の項目が無い。description に含めるか、項目を足すか | 概念設計 → API 設計 |
| 4 | PlaceCard | kind = facility | places.kind | 設備は Place.kind に無い(※) | 概念設計 |
| 5 | Chip | label(種類の名前) | places の種類 | 運営の種類(defineLabel・assignLabel)は、#15 で「除外(OQ-3)」。種類を API で返さないと、チップが作れない | API 設計(OQ-3) |
| 6 | DestinationCard | headingDeg・remainingM・updatedAt | なし | 端末で計算する(D-003)。API の項目は要らない。行き先を端末に置くか(OQ-12)で変わらない | なし(確認だけ) |
| 7 | (カメラ)BuildingCameraOverlay | 建物の形 | landmarks の形 ※ | GPS 方式では、建物の形を API で返す必要がある(基準画像ではなく) | 概念設計 → API 設計 |

| 8 | Toast | onUndo(スタンプの取り消し) | なし | #15 では retractStamp を「除外(OQ-12)」にしている。取り消しを端末だけで行うのか、API で消すのかが決まっていない | API 設計(OQ-12) |
| 9 | BuildingFlag | count(建物ごとの企画数) | なし | 端末で places から数えるには、場所が建物を持つ必要がある(※) | 概念設計 |
| 10 | StampMark | pressedAt | stamps の押した時刻 | 期限を過ぎた混雑を、API が返さないのか、端末で隠すのか(OQ-4) | API 設計(OQ-4) |

## 照合して問題なかったもの

- タグの状態(wantToGo・favorite)、絞り込み(selected・labels・count): 端末の中で完結するので、API の項目は要らない(D-014)
- 距離(distanceM): places の位置と端末の現在地から計算する
