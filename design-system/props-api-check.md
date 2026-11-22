# 部品の props と API の項目の照合(ステップ 4)

作成: 2026-11-22 / 更新: 2026-11-23(概念設計の D-017〜D-022(#24)と、API 設計のドラフト(#21)に合わせた)
対象: `components/` の部品と、API 設計(#21 の OpenAPI ドラフト。ゲートは未承認なので、項目名は変わりうる)

## 食い違い・要確認(API 設計の台帳 `concept-design/api/review-ledger.yaml` に載せる候補)

| # | 部品 | props | API 側 | 食い違い | 状態(2026-11-23) |
|---|---|---|---|---|---|
| 1 | PlaceRow・PlaceCard | placeId | places.id | **会期中に変わらないこと**を API 側に求める(端末のタグが id で覚える。#17) | 解消: 概念で、開催期間中は id を変えず、取り除いた id を再び使わないと決めた(D-017、API-31) |
| 2 | PlaceRow・PlaceCard | building・floor | places の建物・階 | 概念 Place に「建物と階」が無い(※) | 解消: Place に building・floor が入った(D-017)。API では `landmarkId`・`floor`。部品には建物の名前と「2階」の形で渡す |
| 3 | PlaceCard | hours(開催時間) | places.hours | 概念 Place に時間の項目が無い。description に含めるか、項目を足すか | 解消: Place.hours(開始と終了の組、複数可)として持つ(D-020)。部品は表示用の文字列を受け、組からの整形は画面の側で 1 か所にまとめる(`decisions.md`)。API の PlaceInput・Place に hours を足す(#21 にはまだ無い) |
| 4 | PlaceCard・FacilityMark | kind = facility | places.kind | 設備は Place.kind に無い(※) | 解消: Place.kind に設備 4 種(案内所・トイレ・休憩所・ゴミ箱)が入った(D-017)。設備は検索・絞り込みの対象にしない |
| 5 | Chip | label(種類の名前) | places の種類 | 種類を API で返さないと、チップが作れない(OQ-3) | 解消: `GET /labels`(運営の種類の一覧)と、各場所の `labelIds` で作れる(#21、同期 show-labels) |
| 6 | DestinationCard | headingDeg・remainingM・updatedAt | なし | 端末で計算する(D-003)。API の項目は要らない | 確認だけ(変更なし) |
| 7 | BuildingCameraOverlay・BuildingShapePreview | 建物の形 | landmarks の輪郭 | GPS 方式では、建物の形を API で返す必要がある(基準画像ではなく) | 解消: Landmark は image をやめ、輪郭(footprint)を持つ(D-018)。輪郭は OpenStreetMap を正にし、運営は描かない・直さない。「形を読み込み直す」は同期 reload-footprint(D-019)。端末へ同梱するか API から返すかは未決(OQ-16) |
| 8 | Toast・MyStampRow | onUndo・onRetract(スタンプの取り消し) | stamps の取り消し | 取り消しを端末だけで行うのか、API で消すのかが決まっていない | 解消: API で消す。押したときに受け取る取り消しの証(proof)を端末が覚え、その一致で確かめる。Stamp.by はやめた(D-021) |
| 9 | BuildingFlag | count(建物ごとの企画数) | なし | 端末で places から数えるには、場所が建物を持つ必要がある(※) | 解消: places の building(`landmarkId`)で、端末で数えられる(D-017) |
| 10 | StampMark・MyStampRow | pressedAt・expiresAt | stamps の押した時刻 | 期限を過ぎた混雑を、API が返さないのか、端末で隠すのか(OQ-4) | 端末が pressedAt から隠す前提で進める。期限は仮置き(混雑 30 分、感想はその日の閉場まで。D-022)。最終値はチームが決める(OQ-4) |

## 照合して問題なかったもの

- タグの状態(wantToGo・favorite)、絞り込み(selected・labels・count): 端末の中で完結するので、API の項目は要らない(D-014)。絞り込みは端末で行い、運営の種類どうしは OR、自分用のタグは AND(D-016、D-017)
- 距離(distanceM): places の位置と端末の現在地から計算する

## まだ決まっていないこと(部品の側では直さない)

- 見取り図を新しい概念にするか(OQ-14)。BuildingFloorPlan の `plan`
- 輪郭の配り方(OQ-16)。BuildingShapePreview・BuildingCameraOverlay の輪郭
- スタンプの期限の最終値(OQ-4)
