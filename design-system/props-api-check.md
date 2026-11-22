# 部品の props と API の項目の照合(ステップ 4)

作成: 2026-11-22 / 更新: 2026-11-23(概念設計の D-017〜D-022(#24)と、API 設計(#21)の照合のコメントに合わせた)
対象: `components/` の部品と、API 設計(#21 の `concept-design/api/openapi.yaml`。ゲートは未承認なので、項目名は変わりうる)

## 食い違い・要確認(API 設計の台帳 `concept-design/api/review-ledger.yaml` に載せる候補)

| # | 部品 | props | API 側 | 食い違い | 状態(2026-11-23) |
|---|---|---|---|---|---|
| 1 | PlaceRow・PlaceCard | placeId | places.id | **会期中に変わらないこと**を API 側に求める(端末のタグが id で覚える。#17) | 解消: 開催期間中は id を変えず、取り除いた id を再び使わない(D-017、API-31)。#21 で対応 |
| 2 | PlaceRow・PlaceCard・BuildingFlag | building・floor・landmarkId | places.landmarkId・floor | 概念 Place に「建物と階」が無い(※) | 解消: Place に building・floor が入った(D-017)。#21 では `landmarkId`・`floor`(整数)。部品には建物の名前と「2階」の形で渡す(API-35)。BuildingFlag の id は `landmarkId` にそろえた(API-39) |
| 3 | PlaceCard | hours(開催時間) | places.hours | 概念 Place に時間の項目が無い | 解消: Place.hours(開始と終了の組、複数可)として持つ(D-020)。#21 は開始と終了の日時の組で返す。部品は表示用の文字列を受け、組からの整形は画面の側で 1 か所にまとめる(`decisions.md`、API-35) |
| 4 | PlaceCard・FacilityMark | kind | places.kind | 設備は Place.kind に無い(※) | 解消: 設備 4 種が入った(D-017)。#21 の種別は英語のコード 6 つ(`event`・`parking`・`info`・`wc`・`rest`・`trash`)。FacilityMark の kind はそのまま、PlaceCard には画面の側で `facility` にまとめて渡す(API-36)。設備は検索・絞り込みの対象にしない |
| 5 | Chip | label(種類の名前) | GET /labels・places.labelIds | 種類を API で返さないと、チップが作れない(OQ-3) | 解消: `GET /labels`(運営の種類の一覧)と、場所の応答の `labelIds` で作れる(#21、同期 show-labels) |
| 6 | DestinationCard | headingDeg・remainingM・updatedAt | なし | 端末で計算する(D-003)。API の項目は要らない | 確認だけ(変更なし) |
| 7 | BuildingCameraOverlay・BuildingShapePreview | 建物の形 | landmarks.footprint | GPS 方式では、建物の形を API で返す必要がある(基準画像ではなく) | 解消: Landmark は image をやめ、輪郭(footprint)を持つ(D-018)。輪郭は OpenStreetMap を正にし、運営は描かない・直さない(D-019)。#21 は `footprint` を返し、輪郭の無い建物は `null`(BuildingShapePreview の「形なし」。API-37、合意待ち)。端末へ同梱するか API から返すかは未決(OQ-16) |
| 8 | Toast・MyStampRow | onUndo・onRetract(スタンプの取り消し) | DELETE /stamps/{stampId} | 取り消しを端末だけで行うのか、API で消すのかが決まっていない | 解消: API で消す(D-021)。押したときの応答の `proof` を端末が覚え、取り消すときにヘッダー `X-Stamp-Proof` で渡す(#21) |
| 9 | BuildingFlag | count(建物ごとの企画数) | places.landmarkId | 端末で places から数えるには、場所が建物を持つ必要がある(※) | 解消: 場所の `landmarkId` で、端末で数えられる(D-017、#21) |
| 10 | StampMark・MyStampRow | pressedAt・expiresAt | stamps.pressedAt・expiresAt | 期限を過ぎた混雑を、API が返さないのか、端末で隠すのか(OQ-4) | 端末が pressedAt から隠す前提で進める。#21 は `expiresAt` を返すので、MyStampRow にそのまま渡す(API-38)。期限は仮置き(混雑 30 分、感想はその日の閉場まで。D-022)。最終値はチームが決める(OQ-4) |

## 照合して問題なかったもの

- タグの状態(wantToGo・favorite)、絞り込み(selected・labels・count): 端末の中で完結するので、API の項目は要らない(D-014)。絞り込みは端末で行い、運営の種類どうしは OR、自分用のタグは AND(D-016、D-017)
- 距離(distanceM): places の位置と端末の現在地から計算する

## API 側で部品に合わせて決めたこと(#21。参考)

- スタンプの種類は `StampKind` と同じ値(`congestion-1`〜`congestion-5`・`fun`・`food`・`good`。API-36)
- 見取り図は `BuildingFloorPlan.plan` と同じ `{viewBox, d}` で返す。企画の位置は返さず、見取り図の四隅の緯度経度(`bounds`)から、画面が x・y を計算する(API-29・30。チームの合意待ち)
- 階(`floor`)は整数、開催時間(`hours`)は開始と終了の日時の組。部品の文字列(「2階」「両日 10:00〜16:00」)は画面の側で組み立てる(API-35)

## まだ決まっていないこと(部品の側では直さない)

- 見取り図を新しい概念にするか(OQ-14)。BuildingFloorPlan の `plan`
- 輪郭の配り方(OQ-16)。BuildingShapePreview・BuildingCameraOverlay の輪郭
- スタンプの期限の最終値(OQ-4)
